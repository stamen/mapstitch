"use strict";

var DEFAULT_TILE_SIZE = 256,
    TILE_ERROR_COLOR = "rgba(0, 0, 0, 0)",
    DEBUG = !!process.env.DEBUG;

var assert = require("assert");

var async = require("async"),
    d3 = require("d3"),
    request = require("request"),
    Canvas = require("canvas"),
    Image = Canvas.Image,
    SphericalMercator = require("sphericalmercator");

var TILE_SIZE,
    merc,
    validate,
    MAX_TILES = 625; // 25x25

var debug = {
  log: function() {
    if (DEBUG) {
      console.log.apply(null, arguments);
    }
  },
  time: function() {
    if (DEBUG) {
      console.time.apply(null, arguments);
    }
  },
  timeEnd: function() {
    if (DEBUG) {
      console.timeEnd.apply(null, arguments);
    }
  }
};

module.exports = exports = function(options) {
  TILE_SIZE = options.tileSize || DEFAULT_TILE_SIZE;
  validate = typeof options.validate === "function" ? options.validate.bind(stitch) : stitch.validate;
  MAX_TILES = options.maxTiles || MAX_TILES;

  merc = new SphericalMercator({ size: TILE_SIZE });

  return stitch;
};

/**
 * Stitch tiles into a single image.
 *
 * @param {string} providerTemplate Provider URL template.
 * @param {Object} view Extent(s) and zoom.
 * @param {Function} callback (Error, Canvas) callback.
 */
var stitch = function(providerTemplate, view, callback) {
  var tiles = getTilesForView(view);
  var urls = makeUrls(providerTemplate, tiles);
  var tasks = makeTasks(urls);

  var rows = tiles.length,
      cols = tiles[0].length;

  if (rows * cols > MAX_TILES) {
    return callback(new Error("Too many tiles to fetch: " + rows * cols));
  }

  debug.time("fetching tiles");

  async.parallel(tasks, function(err, results) {
    debug.timeEnd("fetching tiles");

    if (err) {
      return callback(err);
    }

    debug.time("stitching");

    var canvas = new Canvas(rows * TILE_SIZE, cols * TILE_SIZE),
        ctx = canvas.getContext("2d");

    if (view.backgroundColor) {
      ctx.fillStyle = view.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    var x = 0,
        y = 0;
    results.forEach(function(img, i) {
      if (img) {
        try {
          ctx.drawImage(img, x, y, TILE_SIZE, TILE_SIZE);
        } catch (err) {
          console.error("%s failed to draw.", img.url);
          ctx.fillStyle = TILE_ERROR_COLOR;
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }

      if (i % cols === cols - 1) {
        x += TILE_SIZE;
        y = 0;
      } else {
        y += TILE_SIZE;
      }
    });

    debug.timeEnd("stitching");

    return callback(null, canvas);
  });
};

// Export debug into stitch namespace
stitch.debug = debug;

var getTiles = function(zoom, range) {
  return d3.range(range.minX, range.maxX + 1).map(function(x) {
    return d3.range(range.minY + 1, range.maxY).map(function(y) {
      return {
        zoom: zoom,
        x: x,
        y: y
      };
    });
  });
};

var getTilesForView = stitch.getTilesForView = function(view) {
  var tiles = view.extents.map(function(extent) {
    return getTiles(view.zoom, merc.xyz(extent, view.zoom));
  });

  return Array.prototype.concat.apply([], tiles);
};

/**
 * Determine an appropriate zoom level given an extent and desired dimensions.
 */
var getView = stitch.getView = function(extent, width, height) {
  var zoom = 2,
      bbox;

  // this extent crosses the antimeridian
  if (extent[0] > extent[2]) {
    // split the extent into 2 pieces
    var left = [extent[0], extent[1], 180, extent[3]];
    var right = [-180, extent[1], extent[2], extent[3]];

    // calculate widths
    var leftWidth = (left[2] - left[0]) / ((left[2] - left[0]) + (right[2] - right[0])) * width;
    var rightWidth = (right[2] - right[0]) / ((left[2] - left[0]) + (right[2] - right[0])) * width;

    // recursively calculate views for each piece
    var leftView = getView(left, leftWidth, height);
    var rightView = getView(right, rightWidth, height);

    // zooms should match
    assert.equal(leftView.zoom, rightView.zoom, "left and right zooms should match");

    return {
      extents: [left, right],
      zoom: leftView.zoom
    };
  }

  var bounds = [[extent[0], extent[1]], [extent[2], extent[3]]];

  // loop until the pixel delta is larger than the desired width and height
  do {
    zoom++;
    bbox = [merc.px(bounds[0], zoom), merc.px(bounds[1], zoom)];
  } while (zoom <= 20 && bbox[1][0] - bbox[0][0] < width || bbox[1][1] - bbox[0][1] < height);

  return {
    extents: [extent], // return the original extent, otherwise it ends up on tile boundaries
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
      debug.time(url);

      request({
        url: url,
        encoding: null
      }, function(err, res, body) {
        debug.timeEnd(url);

        // validate the response
        return validate(err, res, function(err) {
          if (err) {
            return callback(err);
          }

          if (res.statusCode === 200) {
            var img = new Image();
            img.src = body;
            img.url = url;

            return callback(null, img);
          }

          // successful (per validate()), but no image data available
          return callback();
        });
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

  var nw,
      se,
      sourceWidth,
      sourceHeight;

  if (view.extents.length === 2) {
    // extent crosses the antimeridian

    debug.log(view.extents[0][0], view.extents[0][1]);
    debug.log(view.extents[1][2], view.extents[1][3]);

    nw = merc.px([view.extents[0][0], view.extents[0][1]], view.zoom);
    se = merc.px([view.extents[1][2], view.extents[1][3]], view.zoom);

    // complicated way of determining the x-value for 180º
    var am = merc.px([180, view.extents[0][1]], view.zoom);

    sourceWidth = (am[0] - nw[0]) + se[0];
    sourceHeight = se[1] - nw[1];
  } else {
    var extent = view.extents[0];

    nw = merc.px([extent[0], extent[1]], view.zoom);
    se = merc.px([extent[2], extent[3]], view.zoom);

    sourceWidth = se[0] - nw[0];
    sourceHeight = se[1] - nw[1];
  }

  var startX = nw[0] % TILE_SIZE,
      startY = nw[1] % TILE_SIZE;

  debug.log("width: %d, height: %d", width, height);
  debug.log("canvas.width: %d, canvas.height: %d", canvas.width, canvas.height);
  debug.log("sourceWidth: %d, sourceHeight: %d", sourceWidth, sourceHeight);
  targetCtx.drawImage(canvas, startX, startY, sourceWidth, sourceHeight,
                              0, 0, width, height);

  return target;
};

var cropToCenter = stitch.cropToCenter = function(canvas, width, height) {
  var target = new Canvas(width, height),
      targetCtx = target.getContext("2d");

  var xOffset = (canvas.width - width) / 2,
      yOffset = (canvas.height - height) / 2;

  targetCtx.drawImage(canvas, -xOffset, -yOffset);

  return target;
};

var resize = stitch.resize = function(canvas, width, height) {
  var target = new Canvas(width, height),
      targetCtx = target.getContext("2d");

  var aspectRatio = canvas.width / canvas.height,
      targetWidth = Math.max(width, height * aspectRatio),
      targetHeight = Math.max(height, width / aspectRatio),
      xOffset = (targetWidth - width) / 2,
      yOffset = (targetHeight - height) / 2;

  // TODO use ImageMagick to the same effect w/ better results when scaling
  // see http://www.imagemagick.org/script/command-line-options.php?#crop
  targetCtx.drawImage(canvas,
                      0, 0, canvas.width, canvas.height,
                      -xOffset, -yOffset, targetWidth, targetHeight);

  return target;
};
