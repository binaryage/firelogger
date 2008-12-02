# FirePython Addon

FirePython is a sexy Python logger console integrated into [Firebug][firebug]. You'll need Firebug 1.2 or higher.

**See [main homepage here][homepage]**

![screenshot][screenshot]

# Build instructions

If you want to install latest addon from sources, you need to build it. 
It should be simple, but make sure you have these tools on your paths:

* git
* zip
* ruby and rake

## Build steps:

    git clone git://github.com/woid/firepython-addon.git
    git clone git://github.com/woid/firepython.git
    cd firepython
    rake
  
After that our XPI should be available in ``firepython/build/firepython-X.Y.xpi``.

You should be able to install XPI file into Firefox: ``File -> Open File`` ... and browse for ``firepython-X.Y.xpi``.

Remember, that you should be also using latest FirePython library on server-side.

[screenshot]: http://github.com/woid/firepython-addon/tree/master/support/screenshot.png?raw=true "FirePython in action"
[firebug]: https://addons.mozilla.org/en-US/firefox/addon/1843
[homepage]: http://github.com/woid/firepython
