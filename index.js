"use strict";

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
    merc = new SphericalMercator({ size: 256 });

var PROVIDERS = require("./providers.json");

app.configure(function() {
  app.use(express.responseTime());
  app.use(express.logger());
  app.use(cors());

  http.globalAgent.maxSockets = 32;
});

app.get("/mapimg", function(req, res) {
  console.log(req.query);
  var zoom = 2,
      bbox,
      width = +req.query.w || 1500,
      height = +req.query.h || 1000,
      extent = req.query.extent.split(":", 4);

  // rewrite extent in xy order
  extent = [extent.slice(0, 2).reverse(), extent.slice(2, 4).reverse()];

  // loop until the pixel delta is larger than the desired width and height
  do {
    zoom++;
    bbox = [merc.px(extent[0], zoom), merc.px(extent[1], zoom)];
  } while (bbox[1][0] - bbox[0][0] < width || bbox[1][1] - bbox[0][1] < height);

  var tileRange = merc.xyz(merc.ll(bbox[0], zoom).concat(merc.ll(bbox[1], zoom)), zoom);

  var tiles = d3.range(tileRange.minX, tileRange.maxX + 1).map(function(x) {
    // tileRange.*Y is backward because our y coordinates start at the top
    return d3.range(tileRange.maxY, tileRange.minY + 1).map(function(y) {
      return {
        zoom: zoom,
        x: x,
        y: y
      };
    });
  });

  var providerUrl = PROVIDERS[req.query.p];

  if (!providerUrl) {
    // no such source available
    return res.send(404);
  }

  var urls = tiles.reduce(function(a, b) {
    return a.concat(b);
  }, []).map(function(x) {
    return util.format(providerUrl, x.zoom, x.x, x.y);
  });

  var tasks = urls.map(function(url) {
    return function(callback) {
      console.time(url);

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
      });
    };
  });

  console.time("fetching tiles");

  async.parallel(tasks, function(err, results) {
    console.timeEnd("fetching tiles");

    var rows = tiles.length,
        cols = tiles[0].length;

    console.time("stitching");

    var canvas = new Canvas(tiles.length * 256, tiles[0].length * 256),
        ctx = canvas.getContext("2d");

    var x = 0,
        y = 0;
    results.forEach(function(img, i) {
      if (img) {
        ctx.drawImage(img, x, y, 256, 256);
      }

      if (i % cols === cols - 1) {
        x += 256;
        y = 0;
      } else {
        y += 256;
      }
    });

    console.timeEnd("stitching");

    console.time("scaling");

    var target = new Canvas(width, height),
        ctx = target.getContext("2d");

    console.log("width: %d, height: %d", width, height);
    ctx.drawImage(canvas, 0, 0, width, height);

    console.timeEnd("scaling");

    console.time("outputting");

    target.toBuffer(function(err, buf) {
      console.timeEnd("outputting");

      if (err) {
        console.error(err);
        return res.send(500);
      }

      res.set("Content-Type", "image/png");
      res.send(buf);
    });
  });
});

app.listen(process.env.PORT || 8080, function() {
  console.log("Listening at http://%s:%d/", this.address().address, this.address().port);
});
