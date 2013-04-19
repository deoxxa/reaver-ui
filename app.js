#!/usr/bin/env node

var Legobox = require("legobox"),
    stream = require("stream"),
    spawn = require("child_process").spawn;

var LineSplitter = function LineSplitter(options) {
  options = options || {};

  options.objectMode = true;
  options.highWaterMark = options.highWaterMark || 1;

  stream.Transform.call(this, options);

  this.buffer = "";
};
LineSplitter.prototype = Object.create(stream.Transform.prototype);

LineSplitter.prototype._transform = function _transform(input, encoding, done) {
  this.buffer += Buffer(input, encoding).toString();

  var lines = this.buffer.split(/[\r\n]+/);

  this.buffer = lines.pop();

  lines.forEach(function(line) {
    this.push(line);
  }.bind(this));

  return done();
};

var Reaver = function Reaver(options) {
  options = options || {};

  options.objectMode = true;
  options.highWaterMark = options.highWaterMark || 1;

  stream.Writable.call(this, options);

  options.args = options.args || [];
  var args = options.args.reduce(function(i, v) {
    for (var k in v) {
      i.push(k);

      if (v[k] !== null) {
        i.push(v[k]);
      }
    }

    return i;
  }, []);

  this.process = spawn("reaver", args);

  this.process.stdout.pipe(new LineSplitter()).pipe(this);
  this.process.stderr.pipe(new LineSplitter()).pipe(this);
};
Reaver.prototype = Object.create(stream.Writable.prototype);

Reaver.prototype._write = function _write(input, encoding, done) {
  this.emit("line", input);

  var matches;

  if (matches = input.match(/Associated with .+? \(ESSID: (.+)\)/)) {
    this.emit("essid", matches[1]);
  }

  if (matches = input.match(/Trying pin ([0-9]+)/)) {
    this.emit("trying", matches[1]);
  }

  if (matches = input.match(/([0-9]+) seconds\/pin/)) {
    this.emit("speed", parseInt(matches[1]));
  }

  if (matches = input.match(/([0-9\.]+)% complete/)) {
    this.emit("percent", parseFloat(matches[1]));
  }

  if (matches = input.match(/waiting ([0-9]+) seconds before/)) {
    this.emit("waiting", parseInt(matches[1]));
  }

  return done();
};

var container = new Legobox.Container({
  width: process.stdout.columns,
  height: process.stdout.rows,
  split: Legobox.Container.SPLIT.vertical,
});

container.pipe(process.stdout);

container.clear().hide();

var current_time = new Legobox.Text({content: "", align: "center"});
setInterval(function() {
  current_time.content = (new Date()).toISOString();
  current_time.reflow();
}, 1000);
container.addWidget(current_time, {height: 2});

var targets = process.argv.slice(2);

targets.forEach(function(target) {
  var outer = new Legobox.Container({split: Legobox.Container.SPLIT.vertical}, {height: 2});

  var info_container = new Legobox.Container({split: Legobox.Container.SPLIT.horizontal}, {height: 1});

  var bssid_label = new Legobox.Text({content: target, align: "left"}),
      current_label = new Legobox.Text({content: "", align: "left"}),
      locked_label = new Legobox.Text({content: "[  ]", align: "left"}),
      finish_label = new Legobox.Text({content: "                        ", align: "left"}),
      essid_label = new Legobox.Text({content: "()", align: "left"});

  info_container.addWidget(bssid_label, {width: 18}).addWidget(current_label, {width: 9}).addWidget(locked_label, {width: 5}).addWidget(finish_label, {width: 25}).addWidget(essid_label);
  outer.addWidget(info_container);

  var progress_container = new Legobox.Container({split: Legobox.Container.SPLIT.horizontal}, {height: 1});

  var progress_label = new Legobox.Text({content: "", align: "right"}),
      progress_bar = new Legobox.Progress({total: 100, align: "left"});

  progress_label.content = "0%";
  progress_bar.progress = 0;

  progress_container.addWidget(progress_bar).addWidget(progress_label, {width: 7});
  outer.addWidget(progress_container);

  var lines = [];
  var text = new Legobox.Text({content: "", align: "left"});

  container.addWidget(outer, {height: 2});

  var reaver = new Reaver({
    args: [
      {
        "-vv": null,
        "-i": "mon0",
        "-c": "11",
        "-b": target,
      },
    ],
  });

  reaver.on("line", function(line) {
    lines.push(line);
    if (lines.length > 3) {
      lines.shift();
    }
    text.content = lines.join("\n");
    text.reflow();
  });

  var speed = 0;
  reaver.on("speed", function(e) {
    speed = e;
  });

  reaver.on("essid", function(essid) {
    essid_label.content = "(" + essid + ")";
    essid_label.reflow();
  });

  reaver.on("percent", function(percent) {
    progress_label.content = percent.toString() + "%";
    progress_label.reflow();

    progress_bar.progress = Math.round(percent);
    progress_bar.reflow();

    if (speed !== 0) {
      finish_label.content = (new Date(Date.now() + (speed * 100 * (100 - percent) * 1000))).toISOString();
      finish_label.reflow();
    }
  });

  reaver.on("waiting", function(time) {
    var when = new Date(Date.now() + time * 1000);

    var update = function() {
      locked_label.content = "[" + Math.floor((when.valueOf() - Date.now()) / 1000) + "]";
      locked_label.reflow();
    };

    var iv = setInterval(update, 1000);

    setTimeout(function() {
      clearInterval(iv);

      locked_label.content = "[  ]";
      locked_label.reflow();
    }, time * 1000);
  });

  reaver.on("trying", function(key) {
    current_label.content = key.toString();
    current_label.reflow();
  });
});

// force initial (re)flow
container.reflow();
container.reflow();

// make sure we reflow when we need to
process.stdout.on("resize", function() {
  container.width = process.stdout.columns;
  container.height = process.stdout.rows;
  container.clear().reflow();
});

// this just stops the app from closing right away
process.stdin.resume();
