BROWSERIFY := node_modules/.bin/browserify
PHANTOMJS  := phantomjs
JS         := node_modules/.bin/uglifyjs --compress --mangle --comments "/Free software under/"
TAP        := node_modules/.bin/faucet
ISTANBUL   := node_modules/.bin/istanbul

help:
	echo "Try one of: clean, build, test"

clean:
	rm -f *.browser.js *.min.js *.min.js.map
	rm -fr coverage

build:	jrpc.min.js

test:	test.browser.js
	$(ISTANBUL) cover --print none --report lcov -x test.js test.js |$(TAP)
	$(ISTANBUL) report text-summary
	$(PHANTOMJS) test.browser.js |$(TAP)

%.browser.js:	%.js
	$(BROWSERIFY) -s JRPC $< -o $@

%.min.js:	%.browser.js
	$(JS) --source-map $@.map -o $@ -- $<

.PHONY: help clean build test

.SILENT:	help test

.PRECIOUS:	%.browser.js
