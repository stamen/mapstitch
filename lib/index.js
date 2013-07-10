"use strict";

var DEFAULT_TILE_SIZE = 256,
    DEBUG = process.env.DEBUG;

var async = require("async"),
    d3 = require("d3"),
    request = require("request"),
    Canvas = require("canvas"),
    Image = Canvas.Image,
    SphericalMercator = require("sphericalmercator");

var TILE_SIZE,
    merc,
    validate;

module.exports = exports = function(options) {
  TILE_SIZE = options.tileSize || DEFAULT_TILE_SIZE;
  validate = options.validate.bind(stitch) || stitch.validate;

  merc = new SphericalMercator({ size: TILE_SIZE });

  return stitch;
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

  if (DEBUG) console.time("fetching tiles");

  async.parallel(tasks, function(err, results) {
    if (DEBUG) console.timeEnd("fetching tiles");

    if (err) {
      return callback(err);
    }

    if (DEBUG) console.time("stitching");

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

    if (DEBUG) console.timeEnd("stitching");

    return callback(null, canvas);
  });
};


var getTilesForView = stitch.getTilesForView = function(view) {
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
var getView = stitch.getView = function(extent, width, height) {
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

var getDimensionsForView = stitch.getDimensionsForView = function(view) {
  var bbox = [merc.px([view.extent[0], view.extent[1]], view.zoom),
              merc.px([view.extent[2], view.extent[3]], view.zoom)];

  return {
    width: bbox[1][0] - bbox[0][0],
    height: bbox[1][1] - bbox[0][1]
  };
};

stitch.validate = function(err, res, callback) {
  if (err) {
    return callback(err);
  }

  if (res.statusCode === 200) {
    return callback();
  }

  return callback(new Error("Request returned non-200 status code: " + res.statusCode));
};

var makeTasks = function(urls) {
  return urls.map(function(url) {
    return function(callback) {
      if (DEBUG) {
        console.time(url);
        console.time(url + ".ttfb");
      }
      var timed = false;

      request({
        url: url,
        encoding: null
      }, function(err, res, body) {
        if (DEBUG) console.timeEnd(url);

        // validate the response
        return validate(err, res, function(err) {
          if (err) {
            return callback(err);
          }

          if (res.statusCode === 200) {
            var img = new Image();
            img.src = body;

            return callback(null, img);
          }

          // successful (per validate()), but no image data available
          return callback();
        });
      }).on("response", function() {
        if (!timed) {
          timed = true;
          if (DEBUG) console.timeEnd(url + ".ttfb");
        }
      });
    };
  });
};

var makeUrls = function(providerUrl, tiles) {
  return tiles.reduce(function(a, b) {
    return a.concat(b);
  }, []).map(function(x) {
    return providerUrl
           .replace(/\{z\}/i, x.zoom)
           .replace(/\{x\}/i, x.x)
           .replace(/\{y\}/i, x.y);
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
var crop = stitch.crop = function(canvas, view, width, height) {
  var target = new Canvas(width, height),
      targetCtx = target.getContext("2d");

  var nw = merc.px([view.extent[0], view.extent[1]], view.zoom),
      se = merc.px([view.extent[2], view.extent[3]], view.zoom),
      startX = nw[0] % TILE_SIZE,
      startY = nw[1] % TILE_SIZE,
      sourceWidth = se[0] - nw[0],
      sourceHeight = se[1] - nw[1];

  if (DEBUG) console.log("width: %d, height: %d", width, height);
  targetCtx.drawImage(canvas, startX, startY, sourceWidth, sourceHeight,
                              0, 0, width, height);

  return target;
};
