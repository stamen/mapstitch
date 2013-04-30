"use strict";

var TILE_SIZE = process.env.TILE_SIZE || 256,
    DEFAULT_WIDTH = process.env.DEFAULT_WIDTH || 1500,
    DEFAULT_HEIGHT = process.env.DEFAULT_HEIGHT || 1000;

var http = require("http"),
    util = require("util");

var async = require("async"),
    cors = require("cors"),
    d3 = require("d3"),
    express = require("express"),
    app = express(),
    request = require("request"),
    Canvas = require("canvas"),
    Image = Canvas.Image,
    SphericalMercator = require("sphericalmercator"),
    merc = new SphericalMercator({ size: TILE_SIZE });

var PROVIDERS = require("./providers.json");

app.configure(function() {
  app.use(express.responseTime());
  app.use(express.logger());
  app.use(cors());

  http.globalAgent.maxSockets = 32;
});

var getTilesForView = function(view) {
  var tileRange = merc.xyz(view.extent, view.zoom);

  return d3.range(tileRange.minX, tileRange.maxX + 1).map(function(x) {
    // tileRange.*Y is backward because our y coordinates start at the top
    return d3.range(tileRange.maxY, tileRange.minY + 1).map(function(y) {
      return {
        zoom: view.zoom,
        x: x,
        y: y
      };
    });
  });
};

/**
 * Determine an appropriate zoom level given an extent and desired dimensions.
 */
var getView = function(extent, width, height) {
  var zoom = 2,
      bbox;

  var bounds = [[extent[0], extent[1]], [extent[2], extent[3]]];

  // loop until the pixel delta is larger than the desired width and height
  do {
    zoom++;
    bbox = [merc.px(bounds[0], zoom), merc.px(bounds[1], zoom)];
  } while (bbox[1][0] - bbox[0][0] < width || bbox[1][1] - bbox[0][1] < height);

  return {
    extent: extent, // return the original extent, otherwise it ends up on tile boundaries
    zoom: zoom
  };
};

var getDimensionsForView = function(view) {
  var bbox = [merc.px([view.extent[0], view.extent[1]], view.zoom),
              merc.px([view.extent[2], view.extent[3]], view.zoom)];

  return {
    width: bbox[1][0] - bbox[0][0],
    height: bbox[1][1] - bbox[0][1]
  };
};

var makeTasks = function(urls) {
  return urls.map(function(url) {
    return function(callback) {
      console.time(url);
      console.time(url + ".ttfb");
      var timed = false;

      request({
        url: url,
        encoding: null
      }, function(err, res, body) {
        console.timeEnd(url);

        if (err) {
          console.error(err);
        }

        if (res && res.statusCode === 200) {
          var img = new Image();
          img.src = body;

          return callback(null, img);
        } else if (res) {
          console.log(res.statusCode);
        }

        return callback();
      }).on("response", function() {
        if (!timed) {
          timed = true;
          console.timeEnd(url + ".ttfb");
        }
      });
    };
  });
};

var makeUrls = function(providerUrl, tiles) {
  return tiles.reduce(function(a, b) {
    return a.concat(b);
  }, []).map(function(x) {
    return util.format(providerUrl, x.zoom, x.x, x.y);
  });
};

/**
 * Parse extent and attach it to the request as params.extent (as [s, w, n, e]).
 */
var parseExtent = function(req, res, next) {
  if (!req.query.extent) {
    return res.send(400, "'extent' is required");
  }

  // extract the extent
  var extent = req.query.extent.split(":", 4);

  // coerce extent coordinates into Numbers
  extent = extent.map(function(x) {
    return +x;
  });

  req.stitch = req.stitch || {};

  // rewrite coordinates in xy order
  req.stitch.extent = extent.slice(0, 2).reverse().concat(extent.slice(2, 4).reverse());

  return next();
};

var validateProvider = function(req, res, next) {
  req.stitch = req.stitch || {};
  req.stitch.providerTemplate = PROVIDERS[req.query.p];

  if (!req.stitch.providerTemplate) {
    // no such source available
    return res.send(404, "No such provider: " + req.query.p);
  }

  return next();
};

/**
 * Stitch tiles into a single image.
 *
 * @param {string} providerTemplate Provider URL template.
 * @param {Object} view Extent and zoom.
 * @param {Function} callback (Error, Canvas) callback.
 */
var stitch = function(providerTemplate, view, callback) {
  var tiles = getTilesForView(view);
  var urls = makeUrls(providerTemplate, tiles);
  var tasks = makeTasks(urls);

  var rows = tiles.length,
      cols = tiles[0].length;

  console.time("fetching tiles");

  async.parallel(tasks, function(err, results) {
    console.timeEnd("fetching tiles");

    console.time("stitching");

    var canvas = new Canvas(rows * TILE_SIZE, cols * TILE_SIZE),
        ctx = canvas.getContext("2d");

    var x = 0,
        y = 0;
    results.forEach(function(img, i) {
      if (img) {
        ctx.drawImage(img, x, y, TILE_SIZE, TILE_SIZE);
      }

      if (i % cols === cols - 1) {
        x += TILE_SIZE;
        y = 0;
      } else {
        y += TILE_SIZE;
      }
    });

    console.timeEnd("stitching");

    return callback(null, canvas);
  });
};

/**
 * Flush a canvas to a response.
 *
 * @param {Canvas} canvas Canvas to flush.
 * @param {ServerResponse} res Response to flush to.
 */
var flush = function(canvas, res) {
  console.time("outputting");

  canvas.toBuffer(function(err, buf) {
    console.timeEnd("outputting");

    if (err) {
      console.error(err);
      return res.send(500);
    }

    res.set("Content-Type", "image/png");
    return res.send(buf);
  });
};

/**
 * Crop a stitched set of tiles to the desired view, scaling as necessary.
 *
 * @param {Canvas} canvas Source canvas (width and height will be a multiple of
 * TILE_SIZE).
 * @param {Object} view Extent and zoom.
 * @param {Number} width Target width.
 * @param {Number} height Target height.
 */
var crop = function(canvas, view, width, height) {
  var target = new Canvas(width, height),
      targetCtx = target.getContext("2d");

  var nw = merc.px([view.extent[0], view.extent[1]], view.zoom),
      se = merc.px([view.extent[2], view.extent[3]], view.zoom),
      startX = nw[0] % TILE_SIZE,
      startY = nw[1] % TILE_SIZE,
      sourceWidth = se[0] - nw[0],
      sourceHeight = se[1] - nw[1];

  console.log("width: %d, height: %d", width, height);
  targetCtx.drawImage(canvas, startX, startY, sourceWidth, sourceHeight,
                              0, 0, width, height);

  return target;
};

app.get("/", validateProvider, parseExtent, function(req, res) {
  var view = {
    extent: req.stitch.extent,
    zoom: +req.query.zoom
  };

  var dims = getDimensionsForView(view);

  stitch(req.stitch.providerTemplate, view, function(err, canvas) {
    var target = crop(canvas, view, dims.width, dims.height);

    flush(target, res);
  });
});

app.get("/mapimg", validateProvider, parseExtent, function(req, res) {
  var width = +req.query.w || DEFAULT_WIDTH,
      height = +req.query.h || DEFAULT_HEIGHT;

  var view = getView(req.stitch.extent, width, height);

  stitch(req.stitch.providerTemplate, view, function(err, canvas) {
    console.time("scaling");
    var target = crop(canvas, view, width, height);
    console.timeEnd("scaling");

    flush(target, res);
  });
});

app.listen(process.env.PORT || 8080, function() {
  console.log("Listening at http://%s:%d/", this.address().address, this.address().port);
});
