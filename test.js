/* eslint max-len: "off", vars-on-top: "off", require-jsdoc: "off", key-spacing: "off" */

'use strict';

global.Promise = require('bluebird');

var test = require('tape');

var JRPC = require('./jrpc');

function testEcho(params, next) {
  return setImmediate(next.bind(null, false, params));
}

function testErrorTrue(params, next) {
  return setImmediate(next.bind(null, true));
}

function testErrorString(params, next) {
  return setImmediate(next.bind(null, 'error string'));
}

function testErrorData(params, next) {
  return setImmediate(next.bind(null, {hint: true}));
}

function testSlow(params, next) {
  return setTimeout(next.bind(null, false, 'SLOW RESPONSE'), 400);
}

/**
 * Directly connect two JRPC end points with 50ms network latency
 *
 * @param {JRPC} end1 Connecting end
 * @param {JRPC} end2 Serving end
 *
 * @return {undefined} No return value
 */
function connect(end1, end2) {
  end1.setTransmitter(function(msg, next) {
    setTimeout(function() {
      try {
        end2.receive(msg);
        next(false);
      } catch (e) {
        next(true);
      }
    }, 50);
  });
  end2.setTransmitter(function(msg, next) {
    setTimeout(function() {
      try {
        end1.receive(msg);
        next(false);
      } catch (e) {
        next(true);
      }
    }, 50);
  });
}


test('Handling incoming messages', function(t) {
  var r = new JRPC();
  var emptyOutbox = {
    requests : [],
    responses: []
  };

  t.plan(4);

  try {
    r.receive('[ malformed JSON here { ...');
    t.pass('malformed JSON handled gracefully');
  } catch (e) {
    t.fail('malformed JSON crashed');
  }

  r.receive('[]');
  t.deepEqual(
    r.outbox,
    emptyOutbox,
    'outbox still empty after invalid or empty messages'
  );
  t.deepEqual(
    r.localTimers,
    {},
    'localTimers still empty after invalid or empty messages'
  );
  t.deepEqual(
    r.outTimers,
    {},
    'outTimers still empty after invalid or empty messages'
  );
});


test('Handling outgoing messages', function(t) {
  var r = new JRPC();

  t.plan(4);

  r.outbox = {
    requests: [1, 2, 3],
    responses: [3, 4, 5]
  };
  r.transmit(function(msg, next) {
    t.deepEqual(
      r.outbox,
      {requests: [1, 2, 3], responses: []},
      'outbox responses were emptied during transmission attempt'
    );

    r.outbox.responses.push(9);
    next(true);  // We know this is a small synchronous method

    t.deepEqual(
      r.outbox,
      {requests : [1, 2, 3], responses: [9, 3, 4, 5]},
      'outbox responses were restored non-destructively after transmission failure'
    );

    r.outbox.responses = [];
    r.transmit(function(msg, next) {
      t.deepEqual(
        r.outbox,
        {
          requests: [],
          responses: []
        },
        'outbox requests were emptied during transmission attempt'
      );

      r.outbox.requests.push(8);
      next(true);

      t.deepEqual(
        r.outbox,
        {requests: [8, 1, 2, 3], responses: []},
        'outbox requests were restored non-destructively after transmission failure'
      );
    });
  });
});


test('Servicing requests', function(t) {
  var r = new JRPC();
  var i = 0;

  t.plan(5);

  r.expose('listener', function(params, next) {
    t.deepEqual(
      params,
      {hint: true},
      'listen-only method called with expected arguments'
    );
    return setImmediate(next.bind(null, false, 'ignored'));
  });

  r.setTransmitter(function(msg, next) {
    msg = JSON.parse(msg);
    switch (i) {
      case 0:
        t.deepEqual(
          msg,
          {
            jsonrpc: '2.0',
            id: 10,
            error: {code: -32601, message: 'error'}
          },
          'garbage inputs are skipped, error -32601 confirmed (unknown method)'
        );
        break;
      case 1:
        t.deepEqual(
          msg,
          {
            jsonrpc: '2.0',
            id: 11,
            error: {code: -32602, message: 'error'}
          },
          'errors -32602 confirmed (malformed params)'
        );
        break;
      case 2:
        t.deepEqual(
          msg,
          {
            jsonrpc: '2.0',
            id: 12,
            error: {code: -32600, message: 'error'}
          },
          'errors -32600 confirmed (malformed method)'
        );
        break;
      case 3:
        t.deepEqual(
          msg,
          {
            jsonrpc: '2.0',
            id: 13,
            error: {code: -32600, message: 'error'}
          },
          'no response was sent for listen-only method'
        );
        break;
      default:
    }
    i++;
    return next(false);
  });
  r.receive([
    {jsonrpc: '2.0', method: 'unknown', id: 10},
    {},
    undefined,
    null,
    'this is invalid',
    false
  ]);
  r.receive([
    {jsonrpc: '2.0', method: 'system.listComponents', params: 23, id: 11},
    {jsonrpc: '2.0', method: 23, id: 12},
    {jsonrpc: '2.0', method: 'listener', params: {hint: true}},
    {jsonrpc: '2.0', method: 23, id: 13}
  ]);
});


test('I/O and timeouts', function(t) {
  var end1 = new JRPC({remoteTimeout: 0.35, localTimeout: 0.15});
  var end2 = new JRPC({remoteTimeout: 0.35, localTimeout: 0});

  t.plan(22);

  end1.expose('echo', testEcho);
  end1.expose('errorTrue', testErrorTrue);
  end1.expose('errorString', testErrorString);
  end1.expose('errorData', testErrorData);
  end1.expose('slow', testSlow);
  end2.expose({
    echo : testEcho,
    errorTrue: testErrorTrue,
    errorString: testErrorString,
    errorData: testErrorData,
    slow : testSlow
  });

  t.equal(
    end1.localTimeout,
    150,
    'localTimeout is set by constructor'
  );

  t.equal(
    end2.remoteTimeout,
    350,
    'remoteTimeout is set by constructor'
  );

  t.deepEqual(
    end1.exposed.keys,
    end2.exposed.keys,
    'exposing the short and long way yields same structure'
  );

  end1.upgrade();

  t.deepEqual(
    end1.outbox,
    {
      requests: [
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'system.listComponents',
          params: {
            'echo': true,
            'errorTrue': true,
            'errorString': true,
            'errorData': true,
            'slow': true,
            'system.extension.dual-batch': true,
            'system.listComponents': true
          }
        }
      ],
      responses: []
    },
    'upgrade request is pending'
  );

  end1.transmit('invalid');

  t.deepEqual(
    end1.outbox,
    {
      requests: [
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'system.listComponents',
          params: {
            'echo': true,
            'errorTrue': true,
            'errorString': true,
            'errorData': true,
            'slow': true,
            'system.extension.dual-batch': true,
            'system.listComponents': true
          }
        }
      ],
      responses: []
    },
    'bogus transmit left outbox intact'
  );

  connect(end1, end2);

  setTimeout(function() {
    t.deepEqual(
      end1.remoteComponents,
      {
        'system._upgraded': true,
        'system.listComponents': true,
        'system.extension.dual-batch': true,
        'echo': true,
        'errorTrue': true,
        'errorString': true,
        'errorData': true,
        'slow': true
      },
      'origin upgraded successfully'
    );

    t.deepEqual(
      end2.remoteComponents,
      {
        'system._upgraded': true,
        'system.listComponents': true,
        'system.extension.dual-batch': true,
        'echo': true,
        'errorTrue': true,
        'errorString': true,
        'errorData': true,
        'slow': true
      },
      'receiver upgraded successfully'
    );

    end1.call('non-existent', function(err) {
      t.ok(err, 'call to non-existent method yields error');
      t.equals(err.code, -32601, 'call to non-existent method yields error -32601');
    });

    end1.call('system.extension.dual-batch', [], function(err) {
      if (err) {
        t.fail('system.extension.dual-batch returned a JSON-RPC error');
      } else {
        t.pass('system.extension.dual-batch returned success via JSON-RPC');
      }
    });

    end1.expose('listen', function(params, next) {
      t.deepEquals(
        params,
        ['test notification'],
        'call without callback (notification) made it through'
      );
      next(true);
    });
    end2.remoteComponents['listen'] = true;
    end2.notify('listen', ['test notification']);

    end1.call('slow', ['expecting network timeout'], function(err, res) {
      if (err) {
        t.equals(
          err.code,
          -1000,
          'our end got tired of waiting for end1 to respond to slow call'
        );
      } else {
        t.fail('end1 slow method somehow returned: ' + JSON.stringify(res));
      }
    });

    end2.call('slow', ['expecting server to give up'], function(err, res) {
      if (err) {
        t.equals(
          err.code,
          -1002,
          'other end correctly sent us a method-too-slow JSON-RPC error'
        );
      } else {
        t.fail('end2 slow method somehow returned: ' + JSON.stringify(res));
      }
    });

    end1.call('errorTrue', function(err) {
      t.equals(
        err.code,
        -1,
        'errorTrue method yielded -1'
      );
    });
    end1.call('errorString', [], function(err) {
      t.equals(
        err.code,
        -1,
        'errorString method yielded -1'
      );
      t.equals(
        err.message,
        'error string',
        'errorString produced the expected error message'
      );
    });
    end1.call('errorData', [], function(err) {
      t.equals(
        err.code,
        -2,
        'errorData method yielded -2'
      );
      t.deepEquals(
        err.data,
        {hint: true},
        'errorData produced the expected extra error data'
      );
    });

    setTimeout(function() {
      // We want to continue having expected behavior without timeouts
      end1.localTimeout = 0;
      end1.remoteTimeout = 0;
      end2.localTimeout = 0;
      end2.remoteTimeout = 0;

      // Let's create a batch
      end1.setTransmitter(null);
      end2.setTransmitter(null);

      // Let's throw in an invalid response out of nowhere
      end1.outbox.responses.push({id: 1000, result: true});

      end1.call('echo', ['test'], function(err, res) {
        t.notOk(err, 'batch echo 1 is successful');
        t.deepEqual(res, ['test'], 'batch echo 1 returns its own params');
      });
      end1.call('echo', ['test2'], function(err, res) {
        t.notOk(err, 'batch echo 2 is successful');
        t.deepEqual(res, ['test2'], 'batch echo 2 returns its own params');
      });

      end1.setTransmitter(function(msg, next) {
        setImmediate(function() {
          end2.receive(msg);
          next(false);
        });
      });

      setTimeout(function() {
        end2.setTransmitter(function(msg, next) {
          end1.receive(msg);
          next(false);
        });
      }, 100);
    }, 100);
  }, 500);
});

test('Graceful shutdown', function(t) {
  var remote = new JRPC({remoteTimeout: 0.1, localTimeout: 0.1});
  var snitch = false;

  t.plan(2);

  remote
    .call('system.listComponents', null, function() {
      snitch = true;
    })
    .receive({
      jsonrpc: '2.0',
      id: 1,
      method: 'system.listComponents'
    })
    .shutdown()
    .call('system.listComponents', null, function() {
      snitch = true;
    })
    .upgrade()
    .receive('[ malformed JSON here { ...')
    .expose('testMethod', function() {})
  ;

  setTimeout(function() {
    t.notOk(snitch, 'remote timeout was never called');
    t.deepEqual(remote.exposed, {}, 'expose() did nothing');
  }, 250);
});

test.onFinish(function() {
  if (typeof phantom !== 'undefined') {
    /* global phantom: true */
    phantom.exit();
  }
});
