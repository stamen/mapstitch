"use strict";

var TILE_SIZE = process.env.TILE_SIZE || 256,
    DEFAULT_WIDTH = process.env.DEFAULT_WIDTH || 1500,
    DEFAULT_HEIGHT = process.env.DEFAULT_HEIGHT || 1000;

var http = require("http");
var cors = require("cors"),
    express = require("express"),
    app = express();
var stitch = require("./lib/index")({
  tileSize: TILE_SIZE
});

var PROVIDERS = require("./providers.json");

app.configure(function() {
  app.use(express.responseTime());
  app.use(express.logger());
  app.use(cors());

  http.globalAgent.maxSockets = 32;
});

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

app.get("/", validateProvider, parseExtent, function(req, res) {
  var view = {
    extent: req.stitch.extent,
    zoom: +req.query.zoom
  };

  var dims = stitch.getDimensionsForView(view);

  stitch(req.stitch.providerTemplate, view, function(err, canvas) {
    var target = stitch.crop(canvas, view, dims.width, dims.height);

    flush(target, res);
  });
});

app.get("/mapimg", validateProvider, parseExtent, function(req, res) {
  var width = +req.query.w || DEFAULT_WIDTH,
      height = +req.query.h || DEFAULT_HEIGHT;

  var view = stitch.getView(req.stitch.extent, width, height);

  stitch(req.stitch.providerTemplate, view, function(err, canvas) {
    console.time("scaling");
    var target = stitch.crop(canvas, view, width, height);
    console.timeEnd("scaling");

    flush(target, res);
  });
});

app.listen(process.env.PORT || 8080, function() {
  console.log("Listening at http://%s:%d/", this.address().address, this.address().port);
});
