- Periods '.' in method names are handled as separators so that nested objects can be exposed as such natively.

#### Example with browsers' WebSocket

```js
// Declare a method shortcut to call at the other end
remote._bindCall('foo.bar');

// Queue call the other end's 'foo.bar' method using shortcut
remote.foo.bar([], function(err, result) {
  if (err) {
    console.log('Something went wring in foo.bar()!');
  } else {
    console.log('foo.bar() returned: ' + result);
  }
});
```

## API

### remote = new JRPC([*options*])

**bindOnList:** If defined and true, when receiving a call to `server.listComponents()` that includes a list of components from the other side (see protocol extension `dual-batch` in section "RPC API" below), perform a `remote._bindComponents()` automatically.  The initiating end of a connection can thus in a single call initialize native bindings on both ends.

### remote._bindCall(*methodName*)

This will bind a native method corresponding to `methodName` (and `methodNameAsync` if you use Bluebird globally).  This is the reason why all of JRPC's methods start with an underscore '_': to help avoid conflict with actual remote methods.

For example, 'foo.bar' would create `remote.foo.bar` which would be a shortcut to `remote._call('foo.bar', ...)`.

### remote._bindComponents()

This is a very powerful utility:

- The remote system's `system.listComponents()` is called (or queued if you haven't set a transmitter).
- When the response is processed, if indeed the method is supported at the other end, a `_bindCall()` will be made for all component names received.
- Can be called multiple times without affecting performance. (Useful for reconnects.)

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
var help = yield remote.system.methodHelpAsync('system.listComponents');
console.log('system.listComponents usage: ' + help);
```

**CAVEAT:** Of course, none of the components will be available in your `remote` instance until the request is transmitted and the response is received and processed.

The typical usage scenario would be to enable `bindOnList` on the listening side and to invoke `remote._bindComponents()` on the connecting side upon a successful connection.

## RPC API

### system.listComponents([*mine*])

Because protocol extensions are declared as exposed methods, protocol upgrades are available as soon as the second half of the initial round-trip, provided it is for `system.listComponents()` directly (or by `remote._bindComponents()`).
