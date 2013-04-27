"use strict";

var cluster = require("cluster"),
    os = require("os");

if (cluster.isMaster) {
  for (var i = 0; i < os.cpus().length; i++) {
    cluster.fork();
  }
} else {
  // TODO refactor to return an app object
  require("./index");
}
