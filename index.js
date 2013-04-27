"use strict";

var http = require("http"),
    util = require("util");

var async = require("async"),
    d3 = require("d3"),
    request = require("request"),
    Canvas = require("canvas"),
    Image = Canvas.Image;

http.globalAgent.maxSockets = 32;

var tiles = d3.range(653, 659).map(function(x) {
  return d3.range(1581, 1585).map(function(y) {
    return util.format("12/%d/%d.jpg", x, y);
  });
});

var paths = tiles.reduce(function(a, b) {
  return a.concat(b);
}, []);

var tasks = paths.map(function(x) {
  return function(callback) {
    request({
      url: "http://tile.stamen.com/watercolor/" + x,
      encoding: null
    }, function(err, res, body) {
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

async.parallel(tasks, function(err, results) {
  var height = tiles.length,
      width = tiles[0].length;

  var canvas = new Canvas(tiles.length * 256, tiles[0].length * 256),
      ctx = canvas.getContext("2d");

  var x = 0,
      y = 0;
  results.forEach(function(img, i) {
    if (img) {
      ctx.drawImage(img, x, y, 256, 256);
    }

    if (i !== 0 && i % width === 0) {
      x += 256;
      y = 0;
    } else {
      y += 256;
    }
  });

  var fs = require("fs"),
      out = fs.createWriteStream(__dirname + "/out.png"),
      stream = canvas.pngStream();

  stream.pipe(out);
});
