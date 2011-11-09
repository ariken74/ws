/*!
 * WebSocket
 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
 * MIT Licensed
 */

var util = require('util')
  , events = require('events')
  , http = require('http')
  , crypto = require('crypto')
  , url = require('url')
  , Parser = require('Parser');

/**
 * Constants
 */

var protocol = "HyBi-17";
var protocolVersion = 13;

/**
 * WebSocket implementation
 */

function WebSocket(address, options) {
    var serverUrl = url.parse(address);
    if (!serverUrl.host) throw 'invalid url';
    
    options = options || {};
    options.origin = options.origin || null;

    var key = new Buffer(protocol).toString('base64');
    var shasum = crypto.createHash('sha1');
    shasum.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
    var expectedServerKey = shasum.digest('base64');

    var requestOptions = {
        port: serverUrl.port || 80,
        host: serverUrl.hostname,
        path: serverUrl.path || '/',
        headers: {
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Sec-WebSocket-Version': protocolVersion,
            'Sec-WebSocket-Key': key
        }
    };
    if (options.origin) requestOptions.headers.origin = options.origin;

    var req = http.request(requestOptions);
    req.end();
    this._socket = null;
    this._state = 'connecting';
    var parser = new Parser();
    var self = this;
    req.on('upgrade', function(res, socket, upgradeHead) {
        if (self._state == 'disconnected') {
            self.emit('disconnected');
            socket.end();
            return;
        }
        var serverKey = res.headers['sec-websocket-accept'];
        if (typeof serverKey == 'undefined' || serverKey !== expectedServerKey) {
            self.emit('error', 'invalid server key');
            socket.end();
            return;
        }
        self._socket = socket;
        self._state = 'connected';
        socket.setTimeout(0);
        socket.setNoDelay(true);
        socket.on('close', function() {
            self._state = 'disconnected';
            self.emit('disconnected');
        });
        self.emit('connected');
    });
}
util.inherits(WebSocket, events.EventEmitter);

WebSocket.prototype.close = function(data, options) {
    if (this._state != 'connected') throw 'not connected';
    var buf = frameData(0x8, data || '', true, options && options.mask);
    try {
        this._socket.write(buf, 'binary');
        this.terminate();
    }
    catch (e) {
        this.emit('error', e);
        return;
    }
}

WebSocket.prototype.ping = function(data, options) {
    if (this._state != 'connected') throw 'not connected';
    var buf = frameData(0x9, data || '', true, options && options.mask);
    try {
        this._socket.write(buf, 'binary');
    }
    catch (e) {
        this.emit('error', e);
        return;
    }
}

WebSocket.prototype.pong = function(data, options) {
    if (this._state != 'connected') throw 'not connected';
    var buf = frameData(0xa, data || '', true, options && options.mask);
    try {
        this._socket.write(buf, 'binary');
    }
    catch (e) {
        this.emit('error', e);
        return;
    }
}

WebSocket.prototype.send = function(data, options) {
    if (!data) throw 'cannot send empty data';
    if (this._state != 'connected') throw 'not connected';
    var buf;
    if (options && options.binary) buf = frameData(0x2, data, true, options && options.mask);
    else buf = frameData(0x1, data, true, options && options.mask);
    try {
        this._socket.write(buf, 'binary');
    }
    catch (e) {
        this.emit('error', e);
        return;
    }
}

WebSocket.prototype.terminate = function() {
    if (this._socket) {
        this._socket.end();
        this._socket = null;
    }
    else if (this._state == 'connecting') {
        this._state = 'disconnected';
    }
}

module.exports = WebSocket;

function frameData(opcode, data, finalFragment, maskData) {
    var dataBuffer = getBufferFromData(data)
      , dataLength = dataBuffer.length
      , dataOffset = maskData ? 6 : 2
      , secondByte = dataLength;
    if (dataLength > 65536) {
        dataOffset += 8;
        secondByte = 127;
    }
    else if (dataLength > 125) {
        dataOffset += 2;
        secondByte = 126;
    }
    var outputBuffer = new Buffer(dataLength + dataOffset);
    if (finalFragment) opcode = opcode | 0x80;
    outputBuffer[0] = opcode;
    if (maskData) {
        var mask = getRandomMask();
        mask.copy(outputBuffer, dataOffset - 4);
        applyMaskToBuffer(dataBuffer, mask);
        secondByte = secondByte | 0x80;
    }
    outputBuffer[1] = secondByte;
    dataBuffer.copy(outputBuffer, dataOffset);
    switch (secondByte) {
        case 126:
            outputBuffer[2] = dataLength >>> 8;
            outputBuffer[3] = dataLength % 256;
            break;
        case 127:
            var l = dataLength;
            var lengthEndOffset = dataOffset - (maskData ? 4 : 0);
            for (var i = 1; i <= 8; ++i) {
                outputBuffer[lengthEndOffset - i] = l & 0xff;
                l >>>= 8;
            }
    }
    return outputBuffer;
}

function applyMaskToBuffer(buf, mask) {
    if (typeof buf == 'string') buf = new Buffer(buf);
    for (var i = 0, l = buf.length; i < l; ++i) buf[i] ^= mask[i % 4];
    return buf;
}

function getBufferFromData(data) {
    return (data && typeof data.buffer !== 'undefined')
         ? getArrayBuffer(data.buffer)
         : new Buffer(data);
}

function getArrayBuffer(array) {
    var l = array.byteLength
      , buffer = new Buffer(l);
    for (var i = 0; i < l; ++i) {
        buffer[i] = array[i];
    }
    return buffer;
}

function getRandomMask() {
    return new Buffer([
        ~~(Math.random() * 255),
        ~~(Math.random() * 255),
        ~~(Math.random() * 255),
        ~~(Math.random() * 255)
    ]);
}