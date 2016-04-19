# jrpc v3.0.0-alpha

Streaming bidirectional backwards-compatible extended JSON-RPC 2.0 in JavaScript

This rewrite is a full implementation of [JSON-RPC 2.0](http://www.jsonrpc.org/specification) which it extends in useful ways:

- Neither side is a "client" nor a "server" and can emit requests/notifications at any time.
- Periods '.' in method names are handled as separators so that nested objects can be exposed as such natively.
- In line with [XML-RPC's introspection methods](http://scripts.incutio.com/xmlrpc/introspection.html) , the "system" root level name is reserved, which does not interfere with JSON-RPC's "rpc" reservation.
- Backwards-compatible upgrade to request+response message format if both ends implement it.

## REWRITE IN PROGRESS

> This document is roughly in its final form, however the module is being rewritten from scratch to implement the changes.  This repo is **not yet usable**.

## Installation & Usage

### Client-side, stand-alone using Bower

```shell
bower install jrpc --save
```

You can then integrate `bower_components/jrpc/jrpc.min.js` to your build as needed.  (The non-minified version is a CommonJS module, not suitable for direct browser use.)  This was generated using `browserify --standalone` and is thus safe as-is or with various module systems.  Stand-alone example:

```html
<script src="jrpc.min.js"></script>
...
<script type="text/javascript"><!--
  var remote = new JRPC();
  ...
// --></script>
```

#### Example with WebSockets

```js
// Expose a method which the other end can call
remote._expose('test', function(args, callback) {
  return callback(null, 'This is what I return');
});

// Declare a method shortcut to call at the other end
remote._bindCall('foo.bar');

// Create a WebSocket connection
var ws = new WebSocket(someURL);

// Hand off whatever WebSocket receives to JRPC
ws.onmessage = function(ev) {
  remote._process(ev.data);
};

// Queue call the other end's 'foo.bar' method using shortcut
remote.foo.bar([], function(err, result) {
  if (err) {
    console.log('Something went wring in foo.bar()!');
  } else {
    console.log('foo.bar() returned: ' + result);
  }
});

// Send queued calls a single time
remote._transmit(ws.send);
```

Note that I personally use the LongWebSocket wrapper to make sure connections stay alive.


### Node.JS and client-side (CommonJS)

```shell
npm install jrpc --save
```

In Node.JS or if you're using Browserify to bundle CommonJS modules together for client-side use:

```js
var JRPC = require('jrpc');
var remote = new JRPC();
...
```

#### Example with WebSockets

On the server side, instead of the global object `WebSocket` you could use the WebSocketServer implementation, and usage stays otherwise the same:

```js
var WebSocketServer = require('ws').Server;
var ws = new WebSocketServer(...);

ws.on('connection', function(ws) {
  ws.on('message', function(msg) {
    remote._process(msg);
  });
});

// Let JRPC send requests and responses continuously
remote._setTransmitter(ws.send);
```

### Socket.IO

On client and server sides, Socket.IO provides stability, protocol abstraction and channels.  One could perhaps even create multiple JRPC instances to assign to different channels.  The data exchange is otherwise identical to the above WebSocket examples: hand off received messages to `remote._process()` and relay packets to the communications channel with `remote._setTransmit()`.

## API

### remote = new JRPC()

JRPC allows the creation of multiple completely independent instances.

### remote._setRemoteTimeout(*seconds*)

(Default: 10 seconds.)  When `remote._call()` queues a call for the remote end, a timer is started for this delay.  If a response wasn't received and processed by then, the queued call's return callback is invoked with an error condition and the call is flushed from the queue.  If a result eventually arrives after this time, it will be silently discarded.  This helps ensure that the callback for each call is always invoked, and that the queue doesn't grow indefinitely during network outages.

If you expect to deal with network latency, XmlHttpRequest long-poll related delays or network outages, you might want to increase this to 60-120 seconds.

### remote._setLocalTimeout(*seconds*)

(Default: 5 seconds.)  When `remote._process()` launches exposed methods requested in the JSON-RPC request packet it received, a timer is started for this delay.  If the result callback hasn't fired by then, an error response is sent back and the call is flushed from the queue.  If the result callback does fire later, it will be silently discarded.  This helps ensure that servers always respond explicitly to calls, at the expense of possibly ignoring valid long-running results.

If you expect to deal with computationally-intensive methods, you might want to increase this as appropriate.  Make sure, however, that the other end will wait even longer to allow for network latency and outages on top of this execution response time.

### remote._call(*methodName*, *args*, *callback*)

##### Bluebird: remote._callAsync(*methodName*, *args*)

Queue a call to the other end's method `methodName` with `args` as a single argument.  Your callback is _guaranteed_ to be invoked even if the server never responds, in which case it would be in error, after a timeout.

While it is up to implementations to decide what to do with `args`, I recommend an object so that properties can be named.  Arrays are also popular, but future compatibility is more difficult because then order matters.

```js
remote._call('foo', [], function(err, result) {
  if (err) {
    // Something went wrong...
  } else {
    // 'result' was returned by the other end's exposed 'foo()'
  }
});
```

### remote._bindCall(*methodName*)

This will bind a native method corresponding to `methodName` (and `methodNameAsync` if you use Bluebird globally).  This is the reason why all of JRPC's methods start with an underscore '_': to help avoid conflict with actual remote methods.

For example, 'foo.bar' would create `remote.foo.bar` which would be a shortcut to `remote._call('foo.bar', ...)`.

### remote._bindComponents()

This is a very powerful utility:

- The remote system's `system.listComponents()` is called (or queued if you haven't set a transmitter).
- When the response is processed, if indeed the method is supported at the other end, a `_bindCall()` will be made for all component names received.

This means that, after this method returns successfully, you could for example:

```js
remote.system.methodHelp('system.listComponents', function(err, help) {
  if (err) {
    console.log('Something went wrong invoking system.methodHelp');
  } else {
    console.log('system.listComponents usage: ' + help);
  }
});
```

This becomes rather beautiful in a Bluebird coroutine:

```js
var help = remote.system.methodHelpAsync('system.listComponents');
console.log('system.listComponents usage: ' + help);
```

**CAVEAT:** Of course, none of the components will be available in your `remote` instance until the request is transmitted and the response is received and processed.

### remote._expose(*methodName*, *callback*)

Declare `callback` as implementing `methodName` to the other end. Whenever calls from the other end will be processed, `callback` will be invoked:

```js
remote._expose('foo.bar', function(args, callback) {
  return callback(null, 'This is my result string');
});
```

### remote._process(*message*)

Parse `message` as a JSON-RPC 2.0 request or response.  If it's a request, responses will be created and transmitted back (or queued).  If it's a response, callers will receive what they were waiting for.

### remote._transmit(*callback*)

If there is any queued up JSON-RPC to send to the other end, `callback(data)` will be called to send it.

FIXME: We need for THAT callback to call US back with error/success so that we only flag the items as "sent" if successful.

### remote._setTransmitter(*callback*)

Normally, JRPC doesn't know how to send data to the other end.  If you're using a polling communication model, you're probably invoking `remote._transmit()` periodically.  If you're on a fast I/O channel like WebSockets, however, with this method you can tell JRPC to send messages as needed.

To stop this later, `remote._setTransmitter(null)` does the trick.

## RPC API

The `system` reserved module implements some handy introspection methods to help API users discover a server's exposed functionality.

### system.extension.dual-batch()

Returns true; not intended to be called.  Its presence indicates support for the "dual-batch" extension to JSON-RPC 2.0 which was created for this module.  It means that this end can understand messages made up of _two_ JSON-RPC 2.0 messages combined: a batch of responses and a batch of requests.  This is very useful in saving precious round trips in long-polling scenarios where both ends may send requests or notifications.  Simple format:

```json
{
  "results": [],
  "requests": []
}
```

### system.listComponents([*mine*])

Like in XML-RPC, returns an object describing all exposed methods at the time it is called.  Each method name (including periods '.' treated as _regular_ characters) is paired with `true`.  Thus, in a freshly instance, it would return:

```json
{
  "system.listComponents": true,
  "system.methodHelp": true,
  "system.extension.dual-batch": true
}
```

If provided, `mine` should contain the equivalent list from this end.  This allows for both ends to discover each other's capabilities in a single round-trip, typically initiated by the end which established the communication itself.

Unlike any other method, when JRPC is handling a request or result from this call, it caches the capabilities of the other end and will use this cached information if the method is called again (or in the other direction if `mine` was provided).

Because protocol extensions are declared as exposed methods, this means that protocol upgrades are available as soon as the second half of the initial round-trip, provided it is for `system.listComponents()` directly (or by `remote._bindComponents()`).

### system.methodHelp(*methodName*)

Like in XML-RPC, if a method is available by the name `methodName`+'_help', it is assumed to return a string that describes that method.  Per XML-RPC convention, this is a shortcut to that method which will return '' if the help method doesn't exist.

### system.methodSignature(*methodName*)

Reserved per XML-RPC, but not implemented.
