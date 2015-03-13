JS      = uglifyjs --compress --mangle --reserved window "--comments=/Free software under/"
JSLINT  = jslint

help:
	@echo "Try one of: clean, all"

clean:
	rm -f *.min.js

all:	clean $(patsubst %.js,%.min.js,$(wildcard *.js))

%.min.js:	%.js
	$(JS) -o $@ -- $<

%.min.min.js:

.PHONY: help all clean
