/* eslint max-len: "off", vars-on-top: "off", require-jsdoc: "off", key-spacing: "off" */

'use strict';

global.Promise = require('bluebird');

var test = require('tape');

var JRPC = require('./jrpc');

function testEcho(params, next) {
  return setImmediate(next.bind(null, false, 'ECHO RESPONSE'));
}

function testErrorTrue(params, next) {
  return setImmediate(next.bind(null, true));
}

function testErrorString(params, next) {
  return setImmediate(next.bind(null, 'error string'));
}

function testErrorData(params, next) {
  return setImmediate(next.bind(null, { hint: true }));
}

function testSlow(params, next) {
  return setTimeout(next.bind(null, false, 'SLOW RESPONSE'), 400);
}

/**
 * Directly connect two JRPC end points with 50ms network delay
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

test('Servicing requests', function(t) {
  var r = new JRPC();
  var emptyOutbox = {
    requests : [],
    responses: []
  };
  var i = 0;

  t.plan(6);

  r.expose('listener', function(params, next) {
    t.deepEqual(
      params,
      { hint: true },
      'listen-only method called with expected arguments'
    );
    t.equal(
      r.discardSerial,
      -1,
      'for listen-only method, discardSerial was decremented exactly once'
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
            error: { code: -32601, message: 'error' }
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
            error: { code: -32602, message: 'error' }
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
            error: { code: -32600, message: 'error' }
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
            error: { code: -32600, message: 'error' }
          },
          'no response was sent for listen-only method'
        );
      break;
    }
    i++;
    return next(false);
  });
  r.receive([
    { jsonrpc: '2.0', method: 'unknown', id: 10 },
    {},
    undefined,
    null,
    'this is invalid',
    false
  ]);
  r.receive([
    { jsonrpc: '2.0', method: 'system.listComponents', params: 23, id: 11 },
    { jsonrpc: '2.0', method: 23, id: 12 },
    { jsonrpc: '2.0', method: 'listener', params: { hint: true } },
    { jsonrpc: '2.0', method: 23, id: 13 }
  ]);

});

/*
test('Parsing responses', function(t) {
  t.plan(0);
});
*/

test('I/O and timeouts', function(t) {
  var end1 = new JRPC({remoteTimeout: 0.35, localTimeout: 0.15});
  var end2 = new JRPC({remoteTimeout: 0.35, localTimeout: 0});

  t.plan(15);

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

    end1.call('system.extension.dual-batch', [], function(err) {
      if (err) {
        t.fail('system.extension.dual-batch returned a JSON-RPC error');
      } else {
        t.pass('system.extension.dual-batch returned success via JSON-RPC');
      }
    });

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

    end1.call('errorTrue', [], function(err) {
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
        { hint: true },
        'errorData produced the expected extra error data'
      );
    });
  }, 500);
});

test.onFinish(function() {
  if (typeof phantom !== 'undefined') {
    /* global phantom: true */
    phantom.exit();
  }
});
