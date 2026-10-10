This project is to build a scrollytelling explainer for how bleve
works underneath the hood. Inspirations: r2d3.us -- especially
https://r2d3.us/visual-intro-to-machine-learning-part-1/

We intend to build several explainers, starting with how bleve and
zapx's concurrent goroutines of the introducer, persister, merger and
backpressure work, such as in Couchbase Server's cbft project.

Favor plain old JS and CSS, no fancy frameworks like ReactJS. Using
three.js is ok. If you need python, favor uv to prevent touching the
global python setup.

Ideally, we also want linkage to code, so if folks want to drill-down,
there would be pointers to actual files and code lines and/or code
highlighting. URL's to github.com are ok if you decide to not do this
locally.

The scrollytelling narratives ideally should be *.yaml files, for
easier editability for humans, instead of just big *.html files. The
narrative *.yaml might have the sections and steps, along perhaps with
declarative info like animation instructions and pointers to more
info, etc.

Use git commit'ing as you see fit.

Tests appreciated, too, to ensure things work and don't break.
