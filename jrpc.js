/**
 * JRPC: A multiplexed JSON RPC implementation
 *
 * Version: 2.0
 *
 * This is the client implementation for browsers.
 *
 * Use in 3 simple steps:
 *
 * 1. Call once JRPC.set_URL('/my/JRPC/url')
 *
 * 2. Queue up request(s) with:
 * JRPC.add('component', 'method', {args})
 * or:
 * JRPC.add('component', 'method', {args}, f(result, err, errMsg) { ... })
 *
 * 3. Eventually execute all queued requests in a single HTTP request,
 * possibly with a callback to handle retries on failure (i.e.  network
 * unavailable), thus:
 * JRPC.run()
 * or, preferrably for error tolerance:
 * JRPC.run(function (err, errMsg) { ... })
 *
 * JRPC REQUEST FORMAT
 *
 * A request is _always_ a list of uniquely-identified method calls with
 * arguments, thus the protocol is always in "multiplexed" mode.  While args
 * could be any JSON datatype, they _should_ use an object with named
 * properties for sake of clarity in the resulting data exchange if more than
 * one argument is needed.
 *
 * {
 *   JRPC_Version: 2.0,
 *   calls: [
 *     {
 *       id: uniqueIdString,
 *       component: componentNameString,
 *       method: methodNameString,
 *       args: {}
 *     }
 *     ...
 *   ]
 * }
 *
 * JRPC RESPONSE FORMAT
 *
 * A response is a list of exception status and return values (which can be of
 * any JSON datatype), each with an ID matching one from the request.  The
 * response _should_ contain exactly as many results as there were requests,
 * though clients should expect the possibility of never getting some results.
 * (This is also true if the XmlHttpRequest() failed entirely.  This
 * implementation of JRPC doesn't retry on network errors.)
 *
 * {
 *   JRPC_Version: 2.0,
 *   results: [
 *     {
 *       id: matchingUniqueIdString,
 *       exception_raised: bool,
 *       exception: errorString,
 *       result: {}|[]|string|float|bool|null
 *     }
 *     ...
 *   ]
 * }
 *
 * JRPC BUILTIN COMPONENT
 *
 * A special component "system" _must_ be available in a JRPC implementation,
 * with the following methods (loosely inspired by XML-RPC):
 *
 * listComponents(<no arguments>): Returns an object: each key is a
 * component's name containing another object to hold its exposed properties
 * which are functions, set to true.  Example for a bare-bones JRPC service:
 *
 * {
 *   system: {
 *     listComponents: true,
 *     methodHelp: true
 *   }
 * }
 *
 * methodHelp({ component: string, method: string })
 * Returns component.method_help if it is exists and is a string; or "".
 *
 * @package   JRPC
 * @author    Stéphane Lavergne <http://www.imars.com/>
 * @copyright 2012-2013 Stéphane Lavergne
 * @license   http://www.gnu.org/licenses/lgpl-3.0.txt  GNU LGPL version 3
 */

/*jslint node: false, browser: true, es5: false, white: true, nomen: true, plusplus: true */
/*global JRPC: true, $: true */

"use strict";

(function () {

	if (window.JRPC) { return; }

	window.JRPC = {

		/**
		 * Set URL to use for posting JRPC requests
		 *
		 * @param string url
		 *
		 * @return null
		 */
		set_url: function(u) { JRPC.u = u; },
		u: '',

		q: [],

		c: {},

		s: 0,

		/**
		 * Queue a JRPC call to be made
		 *
		 * Your callback funtion will be invoked with the JRPC return value
		 * (possibly an object or array) as its sole argument.
		 *
		 * @param string   component Name of server-side component to request
		 * @param string   method    Name of server-side method in component
		 * @param object   args      Arguments to relay to method
		 * @param function f         Callback to invoke when response is ready (optional)
		 *
		 * @return this
		 */
		add: function(component, method, args, f) {
			JRPC.s++;
			JRPC.q.push({
				'id': 'JRPC_' + (JRPC.s),
				'component': component,
				'method': method,
				'args': args
			});
			if (typeof f === 'function') {
				JRPC.c['JRPC_' + JRPC.s] = f;
			}
			return this;
		},

		/**
		 * Send all spooled JRPC requests
		 *
		 * Upon receipt of a successful AJAX response, all queued callbacks are
		 * invoked with 3 arguments:
		 *
		 * 1. The return value from the server (can be any datatype);
		 * 2. Bool whether an exception was raised;
		 * 3. String the exception message, if any.
		 *
		 * Regardless of AJAX success or failure as a whole, your optional callback
		 * passed to this method will be invoked with 2 arguments:
		 *
		 * 1. Bool whether the whole AJAX request succeeded, so you may perhaps try
		 * again if it failed (all queued requests remain in the queue);
		 * 2. If bool is false, a string relaying the error reported by $.ajax().
		 *
		 * @param function|null f Callback function
		 *
		 * @return null
		 */
		run: function(f) {
			var q = [], outJRPC, done = false, req;

			// Immediate error if browser doesn't support XMLHttpRequest.
			if (!window.XMLHttpRequest && !window.ActiveXObject) {
				if (typeof f === 'function') { f(false, 'Browser missing XMLHttpRequest.'); }
				return null;
			}

			// Move queue into local scope, then act on it.
			q = JRPC.q;
			JRPC.q = [];
			if (q.length > 0) {
				if (window.XMLHttpRequest) {
					req = new XMLHttpRequest();
				} else {
					req = new ActiveXObject("Microsoft.XMLHTTP");
				}
				req.open('POST', JRPC.u, true);
				req.setRequestHeader("X-Requested-With", "XMLHttpRequest");
				req.setRequestHeader("Content-Type", "application/json; charset=ISO-8859-1");
				outJRPC = JSON.stringify({ JRPC_Version: 2.0, calls: q });
				req.send(outJRPC);
				req.onreadystatechange = function () {
					var i = 0, inJRPC = null, statusText = "", atom;
					if ((req.readyState === 4) && (done === false)) {
						// Avoid some browsers firing twice
						done = true;
						try {
							statusText = req.statusText;
						} catch(e1) {
							statusText = "";
						}
						try {
							inJRPC = JSON.parse(req.responseText);
						} catch (e2) {
							inJRPC = null;
							statusText = "Response is not valid JSON.";
						}
						if (req.status >= 200  &&  req.status < 300  &&  inJRPC !== null) {
							if (inJRPC.JRPC_Version && inJRPC.JRPC_Version === 2.0) {
								for (i=0; i < inJRPC.results.length; i++) {
									atom = inJRPC.results[i];
									if (typeof JRPC.c[atom.id] === 'function') {
										JRPC.c[atom.id](atom.result, atom.exception_raised || false, atom.exception || '');
									}
								}
								if (typeof f === 'function') { f(true, ''); }
							} else {
								if (typeof f === 'function') { f(false, 'Invalid JRPC response.'); }
							}
							// Remove all callbacks for which we sent a request,
							// regardless of whether we got a response for it because
							// if we didn't, we never will get one later anyway.
							// If JRPC was invalid, it likely would still be invalid in
							// a subsequent attempt.
							for (i=0; i < q.length; i++) {
								if (typeof JRPC.c[q[i].id] !== 'undefined') {
									delete JRPC.c[q[i].id];
								}
							}
						} else {
							// Throw our local queue back in the main pool: caller will
							// likely want to try run() again soon.
							for (i=0; i < q.length; i++) {
								JRPC.q.push(q[i]);
							}
							if (typeof f === 'function') { f(false, "error "+statusText); }
						}
					}
					return true;
				};
			}
		}

	};

}());
