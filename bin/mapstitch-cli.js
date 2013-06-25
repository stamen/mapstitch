#!/usr/bin/env node
"use strict";

// TODO output format
// TODO output file
// TODO tilesize
var ARGV = require("optimist")
    .usage("Usage: $0 --zoom [zoom] --provider [provider] minX minY maxX maxY")
    .demand(["z", "p"])
    .alias("z", "zoom")
    .alias("p", "provider")
    .describe("z", "Zoom level")
    .describe("p", "Provider template")
    .argv;

var fs = require("fs");
var stitch = require("../lib/index")();

var zoom = ARGV.zoom;

var extent = ARGV._.map(function(x) {
  return +x.replace(",", "");
});

// Rewrite the extents as [minX, maxY, maxX, minY]
// TODO move this

if (extent[0] > extent[2]) {
  var minX = extent[2];
  var maxX = extent[0];
  extent[0] = minX;
  extent[2] = maxX;
}

if (extent[1] < extent[3]) {
  var minY = extent[1];
  var maxY = extent[3];
  extent[1] = maxY;
  extent[3] = minY;
}

var provider = ARGV.provider;

var view = {
  extent: extent,
  zoom: ARGV.zoom
};

var dims = stitch.getDimensionsForView(view);
var tiles = stitch.getTilesForView(view);
console.log("Fetching %d tiles...", tiles.length * tiles[0].length);

stitch(provider, view, function(err, canvas) {
  if (err) {
    console.error("Error while stitching:", err.message);
    return;
  }

  var target = stitch.crop(canvas, view, dims.width, dims.height);

  target.jpegStream().pipe(fs.createWriteStream(__dirname + "/../out.jpg"));
});
