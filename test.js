/* eslint max-len: "off", vars-on-top: "off", require-jsdoc: "off", key-spacing: "off" */

'use strict';

global.Promise = require('bluebird');

var test = require('tape');

var JRPC = require('./jrpc');

function testEcho(params, next) {
  return setImmediate(next.bind(null, false, 'ECHO RESPONSE'));
}

function testError(params, next) {
  return setImmediate(next.bind(null, true));
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

test('Normal I/O', function(t) {
  var end1 = new JRPC({remoteTimeout: 0.35, localTimeout: 0.15});
  var end2 = new JRPC({remoteTimeout: 0.35, localTimeout: 0});

  t.plan(11);

  end1.expose('echo', testEcho);
  end1.expose('error', testError);
  end1.expose('slow', testSlow);
  end2.expose({
    echo : testEcho,
    error: testError,
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
            'error': true,
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
            'error': true,
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
        'error': true,
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
        'error': true,
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

    end1.call('error', [], function(err) {
      t.equals(
        err.code,
        -1,
        'error method yielded -1'
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
