var childProcess = require('child_process'),
    Stream = require('stream').Stream,
    util = require('util'),
    fs = require('fs'),
    getTemporaryFilePath = require('gettemporaryfilepath');

function PngCrush(pngCrushArgs) {
    Stream.call(this);

    this.pngCrushArgs = pngCrushArgs || [];

    this.writable = true;
    this.readable = true;
    this.hasEnded = false;

    this.pngCrushInputFilePath = getTemporaryFilePath({suffix: '.png'});
    this.writeStream = fs.createWriteStream(this.pngCrushInputFilePath);
    this.writeStream.on('error', this._reportError.bind(this));
}

util.inherits(PngCrush, Stream);

PngCrush.prototype.write = function (chunk) {
    this.writeStream.write(chunk);
};

PngCrush.prototype.end = function (chunk) {
    if (chunk) {
        this.write(chunk);
    }
    this.writeStream.end();
    this.writable = false;
    this.writeStream.on('close', function () {
        var pngCrushOutputFilePath = getTemporaryFilePath({suffix: '.png'});
        var writing = true;

        if (this.pngCrushArgs.indexOf('-n') >= 0) {
          writing = false;
          this.pngCrushArgs.push(this.pngCrushInputFilePath);
        } else {
          this.pngCrushArgs.push(this.pngCrushInputFilePath, pngCrushOutputFilePath)
        }
        this.commandLine = 'pngcrush' + (this.pngCrushArgs ? ' ' + this.pngCrushArgs.join(' ') : ''); // For debugging

        var pngCrushProcess = childProcess.spawn('pngcrush', this.pngCrushArgs),
            stdoutChunks = [],
            stderrChunks = [];

        pngCrushProcess.stdout.on('data', function (chunk) {
            stdoutChunks.push(chunk);
        });

        pngCrushProcess.stderr.on('data', function (chunk) {
            stderrChunks.push(chunk);
        });

        pngCrushProcess.on('error', this._reportError.bind(this));

        pngCrushProcess.on('exit', function (exitCode) {
            if (exitCode > 0) {
                return this._reportError(new Error('The pngcrush process exited with a non-zero exit code: ' + exitCode));
            }
            fs.unlink(this.pngCrushInputFilePath, function (err) {
                if (err) {
                    console.error(err.stack);
                }
            });
            fs.stat(pngCrushOutputFilePath, function (err, stats) {
                if (err) {
                  if (writing) {
                    return this._reportError(new Error('pngcrush did not write an output file, stdout output:\n' + Buffer.concat(stdoutChunks).toString('ascii')));
                  } else {
                    this.emit('data', stdoutChunks.join(''));
                    this.emit('data', stderrChunks.join(''));
                    this.emit('end');
                    return
                  }
                }
                this.readStream = fs.createReadStream(pngCrushOutputFilePath);
                if (this.isPaused) {
                    this.readStream.pause();
                }
                this.readStream.on('data', function (chunk) {
                    this.emit('data', chunk);
                }.bind(this));
                this.readStream.on('end', function () {
                    this.hasEnded = true;
                    if (writing) {
                      fs.unlink(pngCrushOutputFilePath, function (err) {
                          if (err) {
                              console.error(err.stack);
                          }
                      });
                    }
                    this.emit('end');
                }.bind(this));
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

PngCrush.prototype._reportError = function (err) {
    if (!this.hasEnded) {
        this.hasEnded = true;
        this.emit('error', err);
    }
};

// Proxy pause and resume to the underlying readStream if it has been
// created, otherwise just keep track of the paused state:
PngCrush.prototype.pause = function () {
    this.isPaused = true;
    if (this.readStream) {
        this.readStream.pause();
    }
};

PngCrush.prototype.resume = function () {
    this.isPaused = false;
    if (this.readStream) {
        this.readStream.resume();
    }
};

module.exports = PngCrush;
