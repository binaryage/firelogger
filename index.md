---
layout: product
title: FireLogger is a sexy server logger console in Firebug
product_title: FireLogger
product_subtitle: a sexy server logger console in Firebug
download: https://addons.mozilla.org/en-US/firefox/addon/11090
repo: http://github.com/darwin/firepython
downloadtitle: Install 0.9
meta_title: FireLogger is a sexy server logger console in Firebug
meta_keywords: firebug,firefox,addon,firelogger,logging,python,php,binaryage,productivity,software,web,development
meta_description: Your logging messages are displayed right under your fingerprints in Firebug
meta_image: http://www.binaryage.com/shared/img/icons/firelogger-256.png
facebook: 1
retweet: 1
buzz: 1
fbsdk: 1
flattr: http://firelogger.binaryage.com
ogmeta: {
    site_name: "BinaryAge website",
    description: "FireLogger is a sexy server logger console in Firebug",
    email: "antonin@binaryage.com",
    type: "product",
    title: "FireLogger",
    url: "http://firelogger.binaryage.com",
    image: "http://www.binaryage.com/shared/img/icons/firelogger-256.png"
}
shots: [{
    title: "FireLogger in action with Python backend",
    thumb: "/shared/img/firelogger4php-mainshot.png",
    full: "/shared/img/firelogger4php-mainshot-full.png"
}]
---


## Firefox

### Firefox Addon

* Your logging messages are displayed right under your fingerprints in Firebug
* Support for rich-text logging (logged objects are sent as JSON object, you may drill down their structure)
* Support for Python and PHP
* Support for exceptions and backtrace visualization
* Ready as WSGI middleware and Django middleware
* Support for profiling graphs
* Support for advanced features:
  * open in Text Editor integration
  * [AppStats](http://blog.binaryage.com/firelogger-with-appstats) for GAE
  * production paths remapping
  * password protection
  * logging proxy support
  * and more ...

### Compatibility

Both Firefox and Firebug are moving targets. Please make sure you use compatible versions. I'm unable to test all possible combinations.

* **Version 0.9**
  * Firebug 1.4 - 1.6 + Firefox 3.5 - 4.0
  * early alpha Firebug 1.7 + Firefox 3.5 - 4.0
* **Version 0.8**
  * Firebug 1.4 and 1.5.3 + Firefox 3.5 or 3.6
  * broken with Firebug 1.5.4+
* **Version 0.7**
  * alpha Firebug 1.5 + Firefox 3.5
  * Firebug 1.4.2 + Firefox 3.5
* **Version 0.6**
  * alpha Firebug 1.5 + Firefox 3.5
  * Firebug 1.4.2 + Firefox 3.5
* **Version 0.5**
  * beta Firebug 1.4 + Firefox 3.0.x or Firefox 3.5
  * does not work with Firebug 1.3 and older!
* **Version 0.4**
  * Firebug 1.3 + Firefox 3.1 
  * Firebug 1.2.1 + Firefox 3.0.4. 
  * does not work with Firebug 1.4 alpha!
* **Version 0.3**
  * Firebug 1.3 + Firefox 3.1 
  * Firebug 1.2.1 + Firefox 3.0.4. 
* **Version 0.2** is tested to work with 
  * alpha Firebug 1.3 and Firefox 3.1.

## Python

Prior to installing check how to install [FireLogger Addon](#firefox).
You definitely need [Firebug 1.4 or higher][firebug]. 
You must also install a Firefox Addon called [FireLogger][firelogger].

### Installation

    pip install FirePython

### Usage

* **Django**: After installation, enable middleware by adding its path to `MIDDLEWARE_CLASSES: firepython.middleware.FirePythonDjango`. 
* **WSGI**: After installation, enable middleware `firepython.middleware.FirePythonWSGI`.
* **Custom**: Look for inspiration at [middleware.py][middleware-source]

#### Real-world examples

* [FirePython added to Bloog][bloog-example] (blog engine for GAE)
* [FirePython added to DryDrop][drydrop-example] (GAE hosting engine for GitHubbers && !Pythonists)
* [FirePython added to Pyxer](http://code.google.com/p/pyxer/wiki/FirePython) (Python web framework)

---

### FAQ

#### logging.debug("hello world!") outputs nothing, what's wrong?
> The default behavior of the logging module is to only output message from level INFO and up. Run "logging.getLogger().setLevel(logging.DEBUG)" to see all messages.

#### Is there something similar for PHP?
> Check out [FireLogger for PHP](http://firelogger.binaryage.com/#php), you may also want to checkout an alternative logging tool,  [FirePHP](http://firephp.org)

#### Is there something similar for Ruby?
> Nope. I'd like to have one, but haven't found time to write server-side support. You are welcome to [hack it](http://wiki.github.com/darwin/firelogger)!

#### How can I change the name of the default logger?
> logging.getLogger().name = "my logger"

#### How can I open preferences?
> Switch to the Logger panel and look at Firebug's toolbar. There is a green bug icon. It's a menu button! <a href="http://cloud.github.com/downloads/darwin/firelogger/FireLoggerMenuButton.png"><img src="http://cloud.github.com/downloads/darwin/firelogger/FireLoggerMenuButton.png"></a><br/><a href="http://cloud.github.com/downloads/darwin/firelogger/FireLoggerPreferences.png"><img src="http://cloud.github.com/downloads/darwin/firelogger/FireLoggerPreferences.png"></a>

#### Clicking on source-file links in Logger panel does nothing. How can I open trace-back sources in TextMate?
> Go to Firebug Menu -> Open With Editor -> Configure editors ... like this: ![TextMate hint][textmate-hint]

#### I was unable to download/install the FireLogger extension from addons.mozilla.org. Can you package latest version for me?
> Some other people have reported this problem too. You may [try this workaround][workaround].

#### How can I see the Python profiling graph?
> 1. enable this feature in FireLogger preferences
> 2. set up an editor in External Editors in Firebug called "Graphviz" (the name is important!). It should be the path to the executable of a viewer for .dot graphs.
> 3. reload the page and you should see an info log line containing profiling info. Clicking on the line launches the configured Graphviz viewer (a filename will be passed as the first parameter)
<a href="http://cloud.github.com/downloads/darwin/firelogger/ExternalEditorsConfiguration.png"><img src="http://cloud.github.com/downloads/darwin/firelogger/ExternalEditorsConfiguration.png"></a><br>
<a href="http://cloud.github.com/downloads/darwin/firepython/FirePython-ProfilingGraphLog.png"><img src="http://cloud.github.com/downloads/darwin/firepython/FirePython-ProfilingGraphLog.png"></a><br>
<a href="http://cloud.github.com/downloads/darwin/firepython/FirePython-ProfilingGraphExample.png"><img src="http://cloud.github.com/downloads/darwin/firepython/FirePython-ProfilingGraphExample.png" width="600"></a>

#### How can I use AppStats support?
> If you are on a production site, make sure you are logged in as a project admin. Also don't forget to enable support in FireLogger's preferences.
<a href="http://cloud.github.com/downloads/darwin/firepython/FirePython-AppStatsExample.png"><img src="http://cloud.github.com/downloads/darwin/firepython/FirePython-AppStatsExample.png"></a>

#### When I start Firefox and the page loads I don't see any log records, what is wrong?
> The initial page content was probably loaded from cache. Refresh your page and you should be ok.

#### My page does multiple AJAX requests to the same URL and I see logs for the first response, but not for others. Am I missing something?
> There is a bug in Firebug 1.4 which calls onResponse multiple times under some circumstances. That was very annoying, so I did a HACK and now test for URL uniqueness in FireLogger. This will unfortunately filter out your multiple AJAX requests. Let's hope for fixes on Firebug side.

## PHP

Requires PHP 5.3 or higher!

#### Download [firelogger.php here][repo]

    require 'firelogger.php';
    flog("Hello world!");

---

### FAQ

#### What is the difference between FireLogger and [FirePHP](http://www.firephp.org/)?
> I initially wrote [FireLogger for Python](http://firepython.binaryage.com/#python) because I was doing some Google App Engine development. Recently, I was asked to do some PHP development. I've tried FirePHP, it worked for me, but it wasn't "pixel perfect" enough to fit my personal taste :-) I'm a javascript who's guy quite opinionated about tools. I wanted flexible dirty logging functionality which is capable of eating whatever I throw into it (like firebug's `console.log`). I also prefer to have server-side a logger console separated from javascript console in Firebug. I prefer reusing Firebug's internal components for inspecting variables. FireLogger has the same look & feel as the javascript console (you can drill down into watches as in Firebug, same fonts and colors, etc.). FireLogger also has some advanced features which may be handy (password protection, "open in text editor" and production path remapping).

#### Is there something similar for Python?
> Check out [FireLogger for Python](http://firepython.binaryage.com/#python)

#### Is there something similar for Ruby?
> Nope. I'd like to have one, but didn't find time to write server-side support. You are welcome to [hack it](http://wiki.github.com/darwin/firelogger)!

#### Clicking on source-file links in Logger panel does nothing. How can I open trace-back sources in TextMate?
> Go to Firebug Menu -> Open With Editor -> Configure editors ... like this: ![TextMate hint][textmate-hint]

#### I was unable to download/install FireLogger extension from addons.mozilla.org. Can you package latest version for me?
> Some other people reported this problem too. You may [try this workaround][workaround].

#### When I start Firefox and the page loads I don't see any log records. What's wrong?
> This is Firefox optimization. After starting, Firefox brings the browser state to the same point where it was when you closed it (no network activity at all). Refresh your page and you should be ok.

## Ruby

<div style="min-height:300px">
I'd like to see this happen... Give me a hand :-)
</div>

## Changelog

### FireLogger Firefox Addon

* **v0.9** (25.10.2010):
  * [[darwin][antonin]] compatibility fixes for Firebug 1.5.4, 1.6 and alpha 1.7
  * [[darwin][antonin]] timestamp hidden under clock symbol
  * [[darwin][antonin]] each row shows short version of file path
  * [[darwin][antonin]] hovering over file paths shows full paths
  * [[darwin][antonin]] PHP-related improvements

* **v0.8** (11.02.2010):
  * [[darwin][antonin]] added AppStats support for GAE ([read more](http://blog.binaryage.com/firelogger-with-appstats))
  * [[darwin][antonin]] fixed bug when logging "something like this %s", param <= the last parameter was not printed into logger
  * [[darwin][antonin]] better formatting string handling ([closes #6](http://github.com/darwin/firepython/issues#issue/6))
  * [[darwin][antonin]] marked as compatible with Firebug 1.6

* **v0.7** (24.08.2009):
  * [[darwin][antonin]] fixed subtle bug when some log records with structs containing null values were not displayed
  * [[darwin][antonin]] removed hack fighting duplicate requests
  * [[darwin][antonin]] every batch of log records is prepended with ticket displaying request url
  * [[darwin][antonin]] added toggle button to persist panel content between refreshes
  * [[darwin][antonin]] rewriter correctly registers under Firebug namespace (fixed some bugs when detaching firebug panel)
  * [[darwin][antonin]] usability: expand root item in watches in case there is only one root item

* **v0.6** (18.08.2009)
  * [[darwin][antonin]] support for PHP ([firelogger.binaryage.com](http://firelogger.binaryage.com))
  * [[darwin][antonin]] fixed bug when warning about disabled console and net panel was not displayed
  * [[darwin][antonin]] fixed broken "Open in external editor" functionality (FB1.5)
  * [[darwin][antonin]] compatibility with FB1.4.2
  * [[darwin][antonin]] compatibility with alpha FB1.5

* **v0.5** (28.06.2009)
  * [[darwin][antonin]] compatibility with Firebug 1.4

* **v0.4** (30.03.2009)
  * [[bslatkin][brett]] profiling graphs for Python (WSGI)

* **v0.3** (16.03.2009)
  * [[darwin][antonin]] compatibility with Firebug 1.2
  * [[darwin][antonin]] password protection for production site
  * [[darwin][antonin]] path rewrite functionality
  * [[darwin][antonin]] console supports rich formatting of python log messages
  * [[darwin][antonin]] Firefox Addon detached as a separate project FireLogger
  * [[darwin][antonin]] option for hiding internal reprs of exported objects

* **v0.2** (24.11.2008)
  * [[darwin][antonin]] fixed Logger panel styles when Firebug window was detached from main window

* **v0.1** (15.11.2008) 
  * [[darwin][antonin]] public alpha release
  * [[darwin][antonin]] communication via response headers
  * [[darwin][antonin]] logging module functionality (debug, info, warning, error, critical)
  * [[darwin][antonin]] log record filtering by type
  * [[darwin][antonin]] log record searching
  * [[darwin][antonin]] opening files in TextMate (click to timestamp field)

---

### FireLogger for PHP

* **v0.3** (25.10.2010)
  * [[darwin][darwin]] compatibility with FireLogger 0.9
  * [[dg][dg]] robust PHP->JSON serialization
  * [[dg][dg]] implemented ability to catch fatal and parse errors
  * [[dg][dg]] code refactoring

* **v0.2** (24.08.2009)
  * [[darwin][darwin]] compatibility with FireLogger 0.7
  * [[darwin][darwin]] support for exceptions with callstack
  * [[darwin][darwin]] password protection
  * [[darwin][darwin]] checking for FireLogger extension header presence
  * [[darwin][darwin]] processing uncaught exceptions
  * [[darwin][darwin]] processing PHP errors
  * [[darwin][darwin]] reflecting private properties (requires PHP 5.3+)

* **v0.1** (17.08.2009)
  * [[darwin][darwin]] compatibility with FireLogger 0.6
  * [[darwin][darwin]] initial implementation, supports basic logging

---

### FireLogger for Python

* **v0.9** (25.10.2010):
  * [[darwin][antonin]] version bump to match the addon

* **v0.8** (11.02.2010):
  * [[meatballhat][dan]] Daniel Buch did pythonification of the whole project, rewrote packaging scripts, added tests and demo site, big kudos!

* **v0.7** (24.08.2010):
  * [[darwin][antonin]] rewriter correctly registers under Firebug namespace (fixed some bugs when detaching firebug panel)
  * [[darwin][antonin]] usability: expand root item in watches in case there is only one root item

* **v0.6** (18.08.2009)
  * [[darwin][antonin]] version bump to match the addon

* **v0.5** (28.06.2009)
  * [[darwin][antonin]] version bump to match the addon

* **v0.4** (30.03.2009)
  * [[bslatkin][brett]] profiling graphs for Python (WSGI)
  * [[piranha][alexander]] enabled profiling support for Django
  * [[piranha][alexander]] PEP-8 code cleanup

* **v0.3** (16.03.2009)
  * [[oxyum][ivan]+[piranha][alexander]] thread-safety
  * [[darwin][antonin]] improved API
  * [[darwin][antonin]] Firefox Addon detached as a separate project FireLogger

* **v0.2** (24.11.2008)
  * [[piranha][alexander]] Django and WSGI middlewares
  * [[piranha][alexander]] added as firepython package to PyPI index

* **v0.1** (15.11.2008) 
  * [[darwin][antonin]] public alpha release
  * [[darwin][antonin]] initial server-side support for Python and Google App Engine
  * [[darwin][antonin]] communication via response headers
  * [[darwin][antonin]] logging module functionality (debug, info, warning, error, critical)
  * [[darwin][antonin]] log record filtering by type
  * [[darwin][antonin]] log record searching

## Links

### Articles

* **[Realtime logging to Firebug using FirePython](http://code.google.com/appengine/articles/firepython.html)** by Antonin Hildebrand
* **[FirePython — no prints?][firepython-no-prints]** by Alexander Solovyov
* **[Integrating FirePython with Pyxer](http://code.google.com/p/pyxer/wiki/FirePython)** by Dirk Holtwick

### Contributors

* **[Alexander Solovyov][alexander]** - python server-side library, Django and WSGI middlewares.
* **[Ivan Fedorov][ivan]** - helped out with threading issues.
* **[Brett Slatkin][brett]** - added profiling feature.
* **[Daniel Buch][dan]** - pythonification of the whole project, rewrote packaging scripts, added tests and demo site, big kudos!
* **[David Grudl][dg]** - various improvements to the PHP library

### Also many thanks to

* **[Joe Hewitt, John J. Barton, Jan Odvarko and others in Firebug working group][firebug-team]**
* **[Christoph Dorn and FirePHP contributors][firephp-authors]**
* **[John Paulett for jsonpickle library][jsonpickle]**
* **[Jose Fonseca for gprof2dot library][gprof2dot]**

[firebug]: https://addons.mozilla.org/en-US/firefox/addon/1843
[appengine]: http://code.google.com/appengine
[firelogger]: https://addons.mozilla.org/en-US/firefox/addon/11090
[homepage]: http://github.com/darwin/firepython
[contact]: mailto:antonin@hildebrand.cz
[workaround]: http://getsatisfaction.com/xrefresh/topics/unable_to_download_rainbow_for_firebug
[firepython-no-prints]:http://blogg.ingspree.net/blog/2008/11/24/firepython-no-prints/
[alexander]:http://github.com/piranha
[ivan]:http://github.com/oxyum
[brett]:http://github.com/bslatkin
[antonin]:http://github.com/darwin
[firebug-team]:http://getfirebug.com/workingGroup
[firephp-authors]:http://www.christophdorn.com/
[irc]:irc://irc.freenode.net/#binaryage
[addon-homepage]: http://github.com/darwin/firepython-addon
[middleware-source]:http://github.com/darwin/firepython/tree/master/middleware.py
[jsonpickle]:http://code.google.com/p/jsonpickle/
[bloog-example]:http://github.com/DocSavage/bloog/commit/346e5fb7c1fd87259dc79f2c4ae852badb6f2b79
[drydrop-example]:http://github.com/darwin/drydrop/tree/22aadc0a463ae76e10aaefdf7aee002c7e605793/dryapp/drydrop_handler.py#L326
[textmate-hint]:http://cloud.github.com/downloads/darwin/firepython/TextMateWithFirePython.png
[activation]:http://blog.getfirebug.com/?p=124
[gprof2dot]:http://code.google.com/p/jrfonseca/wiki/Gprof2Dot
[dan]: http://github.com/meatballhat
[repo]: http://github.com/darwin/firelogger.php
[darwin]:http://github.com/darwin
[dg]:http://github.com/dg
