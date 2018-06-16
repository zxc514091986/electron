'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const fs = require('fs')
const path = require('path')
const os = require('os')
const qs = require('querystring')
const http = require('http')
const {closeWindow} = require('./window-helpers')

const {expect} = chai
chai.use(dirtyChai)

const {ipcRenderer, remote, screen} = require('electron')
const {app, ipcMain, BrowserWindow, BrowserView, protocol, session, webContents} = remote

const features = process.atomBinding('features')

const isCI = remote.getGlobal('isCi')
const nativeModulesEnabled = remote.getGlobal('nativeModulesEnabled')

describe.only('BrowserWindow module', () => {
  const fixtures = path.resolve(__dirname, 'fixtures')
  let w = null
  let ws = null
  let server
  let postData

  const closeTheWindow = () => closeWindow(w).then(() => { w = null })

  before(done => {
    const filePath = path.join(fixtures, 'pages', 'a.html')
    const fileStats = fs.statSync(filePath)
    postData = [
      {
        type: 'rawData',
        bytes: Buffer.from('username=test&file=')
      },
      {
        type: 'file',
        filePath: filePath,
        offset: 0,
        length: fileStats.size,
        modificationTime: fileStats.mtime.getTime() / 1000
      }
    ]
    server = http.createServer((req, res) => {
      function respond () {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', data => {
            if (data) body += data
          })
          req.on('end', () => {
            let parsedData = qs.parse(body)
            fs.readFile(filePath, (err, data) => {
              if (err) return
              if (parsedData.username === 'test' &&
                  parsedData.file === data.toString()) {
                res.end()
              }
            })
          })
        } else {
          res.end()
        }
      }
      setTimeout(respond, req.url.includes('slow') ? 200 : 0)
    })
    server.listen(0, '127.0.0.1', () => {
      server.url = `http://127.0.0.1:${server.address().port}`
      done()
    })
  })

  after(() => {
    server.close()
    server = null
  })

  beforeEach(() => {
    w = new BrowserWindow({
      show: false,
      width: 400,
      height: 400,
      webPreferences: {
        backgroundThrottling: false
      }
    })
  })

  afterEach(closeTheWindow)

  describe('BrowserWindow constructor', () => {
    it('allows passing void 0 as the webContents', () => {
      w.close()
      w = null
      w = new BrowserWindow({ webContents: void 0 })
    })
  })

  describe('BrowserWindow.close()', () => {
    let server

    before(done => {
      server = http.createServer((request, response) => {
        switch (request.url) {
          case '/404':
            response.statusCode = '404'
            response.end()
            break
          case '/301':
            response.statusCode = '301'
            response.setHeader('Location', '/200')
            response.end()
            break
          case '/200':
            response.statusCode = '200'
            response.end('hello')
            break
          case '/title':
            response.statusCode = '200'
            response.end('<title>Hello</title>')
            break
          default:
            done('unsupported endpoint')
        }
      }).listen(0, '127.0.0.1', () => {
        server.url = 'http://127.0.0.1:' + server.address().port
        done()
      })
    })

    after(() => {
      server.close()
      server = null
    })

    it('should emit unload handler', done => {
      w.webContents.on('did-finish-load', () => { w.close() })
      w.once('closed', () => {
        const test = path.join(fixtures, 'api', 'unload')
        const content = fs.readFileSync(test)
        fs.unlinkSync(test)

        expect(String(content)).to.equal('unload')
        done()
      })
      w.loadURL(`file://${path.join(fixtures, 'api', 'unload.html')}`)
    })

    it('should emit beforeunload handler', done => {
      w.once('onbeforeunload', () => { done() })
      w.webContents.on('did-finish-load', () => { w.close() })
      w.loadURL(`file://${path.join(fixtures, 'api', 'beforeunload-false.html')}`)
    })

    it('should not crash when invoked synchronously inside navigation observer', done => {
      const events = [
        { name: 'did-start-loading', url: `${server.url}/200` },
        { name: '-did-get-redirect-request', url: `${server.url}/301` },
        { name: '-did-get-response-details', url: `${server.url}/200` },
        { name: 'dom-ready', url: `${server.url}/200` },
        { name: 'page-title-updated', url: `${server.url}/title` },
        { name: 'did-stop-loading', url: `${server.url}/200` },
        { name: 'did-finish-load', url: `${server.url}/200` },
        { name: 'did-frame-finish-load', url: `${server.url}/200` },
        { name: 'did-fail-load', url: `${server.url}/404` }
      ]
      const responseEvent = 'window-webContents-destroyed'

      function * genNavigationEvent () {
        let eventOptions = null
        while ((eventOptions = events.shift()) && events.length) {
          let w = new BrowserWindow({show: false})
          eventOptions.id = w.id
          eventOptions.responseEvent = responseEvent
          ipcRenderer.send('test-webcontents-navigation-observer', eventOptions)
          yield 1
        }
      }

      let gen = genNavigationEvent()
      ipcRenderer.on(responseEvent, () => {
        if (!gen.next().value) done()
      })
      gen.next()
    })
  })

  describe('window.close()', () => {
    it('should emit unload handler', done => {
      w.once('closed', () => {
        const test = path.join(fixtures, 'api', 'close')
        const content = fs.readFileSync(test)
        fs.unlinkSync(test)

        expect(String(content)).to.equal('close')
        done()
      })
      w.loadURL(`file://${path.join(fixtures, 'api', 'close.html')}`)
    })

    it('should emit beforeunload handler', done => {
      w.once('onbeforeunload', () => { done() })
      w.loadURL(`file://${path.join(fixtures, 'api', 'close-beforeunload-false.html')}`)
    })
  })

  describe('BrowserWindow.destroy()', () => {
    it('prevents users to access methods of webContents', () => {
      const contents = w.webContents
      w.destroy()
      expect(() => {
        contents.getId()
      }).to.throw(/Object has been destroyed/)
    })
  })

  describe('BrowserWindow.loadURL(url)', () => {
    it('should emit did-start-loading event', done => {
      w.webContents.on('did-start-loading', () => { done() })
      w.loadURL('about:blank')
    })

    it('should emit ready-to-show event', done => {
      w.on('ready-to-show', () => { done() })
      w.loadURL('about:blank')
    })

    // TODO(nitsakh): Deprecated
    it('should emit did-get-response-details(deprecated) event', done => {
      // expected {fileName: resourceType} pairs
      const expectedResources = {
        'did-get-response-details.html': 'mainFrame',
        'logo.png': 'image'
      }

      let responses = 0
      w.webContents.on('-did-get-response-details', (event, status, newUrl, oldUrl, responseCode, method, referrer, headers, resourceType) => {
        responses += 1
        const fileName = newUrl.slice(newUrl.lastIndexOf('/') + 1)
        const expectedType = expectedResources[fileName]

        expect(!!expectedType).to.be(true, `Unexpected response details for ${newUrl}`)
        expect(status).to.be.a('boolean', 'status should be boolean')
        expect(responseCode).to.equal(200)
        expect(method).to.equal('GET')

        expect(referrer).to.be.a('string', 'referrer should be string')
        expect(!!headers).to.equal(true, 'headers should be present')

        expect(headers).to.be.an('object', 'headers should be object')
        expect(resourceType).to.equal(expectedType, 'Incorrect resourceType')

        if (responses === Object.keys(expectedResources).length) done()
      })
      w.loadURL(`file://${path.join(fixtures, 'pages', 'did-get-response-details.html')}`)
    })

    it('should emit did-fail-load event for files that do not exist', done => {
      w.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
        expect(code).to.equal(-6)
        expect(desc).to.equal('ERR_FILE_NOT_FOUND')
        expect(isMainFrame).equal(true)
        done()
      })
      w.loadURL('file://a.txt')
    })

    it('should emit did-fail-load event for invalid URL', done => {
      w.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
        expect(desc).to.equal('ERR_INVALID_URL')
        expect(code).to.equal(-300)
        expect(isMainFrame).to.equal(true)
        done()
      })
      w.loadURL('http://example:port')
    })

    it('should set `mainFrame = false` on did-fail-load events in iframes', done => {
      w.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
        expect(isMainFrame).to.equal(false)
        done()
      })
      w.loadURL(`file://${path.join(fixtures, 'api', 'did-fail-load-iframe.html')}`)
    })

    it('does not crash in did-fail-provisional-load handler', done => {
      w.webContents.once('did-fail-provisional-load', () => {
        w.loadURL('http://127.0.0.1:11111')
        done()
      })
      w.loadURL('http://127.0.0.1:11111')
    })

    it('should emit did-fail-load event for URL exceeding character limit', done => {
      w.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
        expect(desc).to.equal('ERR_INVALID_URL')
        expect(code).to.equal(-300)
        expect(isMainFrame).to.equal(true)
        done()
      })
      const data = Buffer.alloc(2 * 1024 * 1024).toString('base64')
      w.loadURL(`data:image/png;base64,${data}`)
    })

    describe('POST navigations', () => {
      afterEach(() => { w.webContents.session.webRequest.onBeforeSendHeaders(null) })

      it('supports specifying POST data', done => {
        w.webContents.on('did-finish-load', () => done())
        w.loadURL(server.url, {postData: postData})
      })

      it('sets the content type header on URL encoded forms', done => {
        w.webContents.on('did-finish-load', () => {
          w.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
            expect(details.requestHeaders['content-type']).to.equal('application/x-www-form-urlencoded')
            done()
          })
          w.webContents.executeJavaScript(`
            form = document.createElement('form')
            document.body.appendChild(form)
            form.method = 'POST'
            form.target = '_blank'
            form.submit()
          `)
        })
        w.loadURL(server.url)
      })

      it('sets the content type header on multi part forms', done => {
        w.webContents.on('did-finish-load', () => {
          w.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
            const headers = details.requestHeaders['content-type']
            expect(headers).includes('multipart/form-data; boundary=----WebKitFormBoundary')
            done()
          })
          w.webContents.executeJavaScript(`
            form = document.createElement('form')
            document.body.appendChild(form)
            form.method = 'POST'
            form.target = '_blank'
            form.enctype = 'multipart/form-data'
            file = document.createElement('input')
            file.type = 'file'
            file.name = 'file'
            form.appendChild(file)
            form.submit()
          `)
        })
        w.loadURL(server.url)
      })
    })

    it('should support support base url for data urls', done => {
      ipcMain.once('answer', (event, test) => {
        expect(test).to.equal('test')
        done()
      })
      w.loadURL('data:text/html,<script src="loaded-from-dataurl.js"></script>', {baseURLForDataURL: `file://${path.join(fixtures, 'api')}${path.sep}`})
    })
  })

  describe('will-navigate event', () => {
    it('allows the window to be closed from the event listener', done => {
      ipcRenderer.send('close-on-will-navigate', w.id)
      ipcRenderer.once('closed-on-will-navigate', () => { done() })
      w.loadURL(`file://${fixtures}/pages/will-navigate.html`)
    })
  })

  describe('BrowserWindow.show()', () => {
    before(function () {
      if (isCI) {
        this.skip()
      }
    })

    it('should focus on window', () => {
      w.show()
      expect(w.isFocused()).to.equal(true)
    })
    it('should make the window visible', () => {
      w.show()
      expect(w.isVisible()).to.equal(true)
    })
    it('emits when window is shown', done => {
      w.once('show', () => {
        expect(w.isVisible()).to.equal(true)
        done()
      })
      w.show()
    })
  })

  describe('BrowserWindow.hide()', () => {
    before(function () {
      if (isCI) {
        this.skip()
      }
    })

    it('should defocus on window', () => {
      w.hide()
      expect(w.isFocused()).to.equal(false)
    })

    it('should make the window not visible', () => {
      w.show()
      w.hide()
      expect(!w.isVisible()).to.equal(false)
    })

    it('emits when window is hidden', done => {
      w.show()
      w.once('hide', () => {
        expect(w.isVisible()).to.equal(false)
        done()
      })
      w.hide()
    })
  })

  describe('BrowserWindow.showInactive()', () => {
    it('should not focus on window', () => {
      w.showInactive()
      expect(w.isFocused()).to.be(false)
    })
  })

  describe('BrowserWindow.focus()', () => {
    it('does not make the window become visible', () => {
      expect(w.isVisible()).to.equal(false)
      w.focus()
      expect(w.isVisible()).to.equal(false)
    })
  })

  describe('BrowserWindow.blur()', () => {
    it('removes focus from window', () => {
      w.blur()
      expect(w.isFocused()).to.equal(false)
    })
  })

  describe('BrowserWindow.getFocusedWindow()', done => {
    it('returns the opener window when dev tools window is focused', done => {
      w.show()
      w.webContents.once('devtools-focused', () => {
        expect(BrowserWindow.getFocusedWindow()).to.deep.equal(w)
        done()
      })
      w.webContents.openDevTools({mode: 'undocked'})
    })
  })

  describe('BrowserWindow.capturePage(rect, callback)', () => {
    it('calls the callback with a Buffer', done => {
      w.capturePage({
        x: 0,
        y: 0,
        width: 100,
        height: 100
      }, (image) => {
        expect(image.isEmpty()).to.equal(true)
        done()
      })
    })

    it('preserves transparency', done => {
      w.close()
      const width = 400
      const height = 400
      w = new BrowserWindow({
        show: false,
        width: width,
        height: height,
        transparent: true
      })
      w.loadURL('data:text/html,<html><body background-color: rgba(255,255,255,0)></body></html>')
      w.once('ready-to-show', () => {
        w.show()
        w.capturePage((image) => {
          let imgBuffer = image.toPNG()
          // Check 25th byte in the PNG
          // Values can be 0,2,3,4, or 6. We want 6, which is RGB + Alpha
          expect(imgBuffer[25]).to.equal(6)
          done()
        })
      })
    })
  })

  describe('BrowserWindow.setSize(width, height)', () => {
    it('sets the window size', done => {
      const size = [300, 400]
      w.once('resize', () => {
        assertBoundsEqual(w.getSize(), size)
        done()
      })
      w.setSize(size[0], size[1])
    })
  })

  describe('BrowserWindow.setMinimum/MaximumSize(width, height)', () => {
    it('sets the maximum and minimum size of the window', () => {
      expect(w.getMinimumSize()).to.deep.equal([0, 0])
      expect(w.getMaximumSize()).to.deep.equal([0, 0])

      w.setMinimumSize(100, 100)
      assertBoundsEqual(w.getMinimumSize(), [100, 100])
      assertBoundsEqual(w.getMaximumSize(), [0, 0])

      w.setMaximumSize(900, 600)
      assertBoundsEqual(w.getMinimumSize(), [100, 100])
      assertBoundsEqual(w.getMaximumSize(), [900, 600])
    })
  })

  describe('BrowserWindow.setAspectRatio(ratio)', () => {
    it('resets the behaviour when passing in 0', done => {
      const size = [300, 400]
      w.setAspectRatio(1 / 2)
      w.setAspectRatio(0)
      w.once('resize', () => {
        assertBoundsEqual(w.getSize(), size)
        done()
      })
      w.setSize(size[0], size[1])
    })
  })

  describe('BrowserWindow.setPosition(x, y)', () => {
    it('sets the window position', done => {
      const pos = [10, 10]
      w.once('move', () => {
        const newPos = w.getPosition()
        expect(newPos[0]).to.equal(pos[0])
        expect(newPos[1]).to.equal(pos[1])
        done()
      })
      w.setPosition(pos[0], pos[1])
    })
  })

  describe('BrowserWindow.setContentSize(width, height)', () => {
    it('sets the content size', () => {
      const size = [400, 400]
      w.setContentSize(size[0], size[1])
      var after = w.getContentSize()
      expect(after[0]).to.equal(size[0])
      expect(after[1]).to.equal(size[1])
    })

    it('works for a frameless window', () => {
      w.destroy()
      w = new BrowserWindow({
        show: false,
        frame: false,
        width: 400,
        height: 400
      })
      const size = [400, 400]
      w.setContentSize(size[0], size[1])
      const after = w.getContentSize()
      expect(after[0]).to.equal(size[0])
      expect(after[1]).to.equal(size[1])
    })
  })

  describe('BrowserWindow.setContentBounds(bounds)', () => {
    it('sets the content size and position', done => {
      const bounds = {x: 10, y: 10, width: 250, height: 250}
      w.once('resize', () => {
        assertBoundsEqual(w.getContentBounds(), bounds)
        done()
      })
      w.setContentBounds(bounds)
    })

    it('works for a frameless window', done => {
      w.destroy()
      w = new BrowserWindow({
        show: false,
        frame: false,
        width: 300,
        height: 300
      })
      const bounds = {x: 10, y: 10, width: 250, height: 250}
      w.once('resize', () => {
        expect(w.getContentBounds()).to.deep.equal(bounds)
        done()
      })
      w.setContentBounds(bounds)
    })
  })

  describe('BrowserWindow.setProgressBar(progress)', () => {
    it('sets the progress', () => {
      expect(() => {
        if (process.platform === 'darwin') {
          app.dock.setIcon(path.join(fixtures, 'assets', 'logo.png'))
        }
        w.setProgressBar(0.5)

        if (process.platform === 'darwin') {
          app.dock.setIcon(null)
        }
        w.setProgressBar(-1)
      }).to.not.throw()
    })

    it('sets the progress using "paused" mode', () => {
      expect(() => { w.setProgressBar(0.5, {mode: 'paused'}) }).to.not.throw()
    })

    it('sets the progress using "error" mode', () => {
      expect(() => { w.setProgressBar(0.5, {mode: 'error'}) })
    })

    it('sets the progress using "normal" mode', () => {
      expect(() => { w.setProgressBar(0.5, {mode: 'normal'}) }).to.not.throw()
    })
  })

  describe('BrowserWindow.setAlwaysOnTop(flag, level)', () => {
    it('sets the window as always on top', () => {
      expect(w.isAlwaysOnTop()).to.equal(false)

      w.setAlwaysOnTop(true, 'screen-saver')
      expect(w.isAlwaysOnTop()).to.equal(true)

      w.setAlwaysOnTop(false)
      expect(w.isAlwaysOnTop()).to.equal(false)

      w.setAlwaysOnTop(true)
      expect(w.isAlwaysOnTop()).to.equal(true)
    })

    it('raises an error when relativeLevel is out of bounds', function () {
      if (process.platform !== 'darwin') {
        // FIXME(alexeykuzmin): Skip the test instead of marking it as passed.
        // afterEach hook won't be run if a test is skipped dynamically.
        // If afterEach isn't run current window won't be destroyed
        // and the next test will fail on assertion in `closeWindow()`.
        // this.skip()
        return
      }

      expect(() => { w.setAlwaysOnTop(true, '', -2147483644) }).to.throw()
      expect(() => { w.setAlwaysOnTop(true, '', 2147483632) }).to.throw()
    })
  })

  describe('BrowserWindow.alwaysOnTop() resets level on minimize', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('resets the windows level on minimize', () => {
      expect(w.isAlwaysOnTop()).to.equal(false)

      w.setAlwaysOnTop(true, 'screen-saver')
      expect(w.isAlwaysOnTop()).to.equal(true)

      w.minimize()
      expect(w.isAlwaysOnTop()).to.equal(false)

      w.restore()
      expect(w.isAlwaysOnTop()).to.equal(true)
    })
  })

  describe('BrowserWindow.setAutoHideCursor(autoHide)', () => {
    describe('on macOS', () => {
      before(function () {
        if (process.platform !== 'darwin') {
          this.skip()
        }
      })

      it('allows changing cursor auto-hiding', () => {
        expect(() => {
          w.setAutoHideCursor(false)
          w.setAutoHideCursor(true)
        }).to.not.throw()
      })
    })

    describe('on non-macOS platforms', () => {
      before(function () {
        if (process.platform === 'darwin') {
          this.skip()
        }
      })

      it('is not available', () => {
        expect(!w.setAutoHideCursor).to.equal(true)
      })
    })
  })

  describe('BrowserWindow.selectPreviousTab()', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('does not throw', () => {
      expect(() => { w.selectPreviousTab() }).to.not.throw()
    })
  })

  describe('BrowserWindow.selectNextTab()', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('does not throw', () => {
      expect(() => { w.selectNextTab() }).to.not.throw()
    })
  })

  describe('BrowserWindow.mergeAllWindows()', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('does not throw', () => {
      expect(() => { w.mergeAllWindows() }).to.not.throw()
    })
  })

  describe('BrowserWindow.moveTabToNewWindow()', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('does not throw', () => {
      expect(() => { w.moveTabToNewWindow() }).to.not.throw()
    })
  })

  describe('BrowserWindow.toggleTabBar()', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('does not throw', () => {
      expect(() => { w.toggleTabBar() }).to.not.throw()
    })
  })

  describe('BrowserWindow.addTabbedWindow()', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('does not throw', done => {
      const tabbedWindow = new BrowserWindow({})
      expect(() => { w.addTabbedWindow(tabbedWindow) }).to.not.throw()

      // Test window + w + tabbedWindow
      expect(BrowserWindow.getAllWindows()).to.have.length(3)

      closeWindow(tabbedWindow, {assertSingleWindow: false}).then(() => {
        // Test window + w
        expect(BrowserWindow.getAllWindows()).to.have.length(3)
        done()
      })
    })

    it('throws when called on itself', () => {
      expect(() => {
        w.addTabbedWindow(w)
      }).to.throw(/AddTabbedWindow cannot be called by a window on itself./)
    })
  })

  describe('BrowserWindow.setVibrancy(type)', () => {
    it('allows setting, changing, and removing the vibrancy', () => {
      expect(() => {
        w.setVibrancy('light')
        w.setVibrancy('dark')
        w.setVibrancy(null)
        w.setVibrancy('ultra-dark')
        w.setVibrancy('')
      }).to.not.throw()
    })
  })

  describe('BrowserWindow.setAppDetails(options)', () => {
    before(function () {
      if (process.platform !== 'win32') {
        this.skip()
      }
    })

    it('supports setting the app details', () => {
      const iconPath = path.join(fixtures, 'assets', 'icon.ico')

      expect(() => {
        w.setAppDetails({appId: 'my.app.id'})
        w.setAppDetails({appIconPath: iconPath, appIconIndex: 0})
        w.setAppDetails({appIconPath: iconPath})
        w.setAppDetails({relaunchCommand: 'my-app.exe arg1 arg2', relaunchDisplayName: 'My app name'})
        w.setAppDetails({relaunchCommand: 'my-app.exe arg1 arg2'})
        w.setAppDetails({relaunchDisplayName: 'My app name'})
        w.setAppDetails({
          appId: 'my.app.id',
          appIconPath: iconPath,
          appIconIndex: 0,
          relaunchCommand: 'my-app.exe arg1 arg2',
          relaunchDisplayName: 'My app name'
        })
        w.setAppDetails({})
      }).to.not.throw()

      expect(() => {
        w.setAppDetails()
      }).to.throw(/Insufficient number of arguments\./)
    })
  })

  describe('BrowserWindow.fromId(id)', () => {
    it('returns the window with id', () => {
      expect(w.id).to.equal(BrowserWindow.fromId(w.id).id)
    })
  })

  describe('BrowserWindow.fromWebContents(webContents)', () => {
    let contents = null

    beforeEach(() => { contents = webContents.create({}) })

    afterEach(() => { contents.destroy() })

    it('returns the window with the webContents', () => {
      expect(BrowserWindow.fromWebContents(w.webContents).id).to.equal(w.id)
      expect(BrowserWindow.fromWebContents(contents)).to.equal(undefined)
    })
  })

  describe('BrowserWindow.fromDevToolsWebContents(webContents)', () => {
    let contents = null

    beforeEach(() => { contents = webContents.create({}) })

    afterEach(() => { contents.destroy() })

    it('returns the window with the webContents', done => {
      w.webContents.once('devtools-opened', () => {
        expect(BrowserWindow.fromDevToolsWebContents(w.devToolsWebContents).id).to.equal(w.id)
        expect(BrowserWindow.fromDevToolsWebContents(w.webContents)).to.equal(undefined)
        expect(BrowserWindow.fromDevToolsWebContents(contents)).to.equal(undefined)
        done()
      })
      w.webContents.openDevTools()
    })
  })

  describe('BrowserWindow.fromBrowserView(browserView)', () => {
    let bv = null

    beforeEach(() => {
      bv = new BrowserView()
      w.setBrowserView(bv)
    })

    afterEach(() => {
      w.setBrowserView(null)
      bv.destroy()
    })

    it('returns the window with the browserView', () => {
      expect(BrowserWindow.fromBrowserView(bv).id).to.equal(w.id)
    })

    it('returns undefined if not attached', () => {
      w.setBrowserView(null)
      expect(BrowserWindow.fromBrowserView(bv)).to.equal(undefined)
    })
  })

  describe('BrowserWindow.setOpacity(opacity)', () => {
    it('make window with initial opacity', () => {
      w.destroy()
      w = new BrowserWindow({
        show: false,
        width: 400,
        height: 400,
        opacity: 0.5
      })
      expect(w.getOpacity()).to.equal(0.5)
    })

    it('allows setting the opacity', () => {
      expect(() => {
        w.setOpacity(0.0)
        expect(w.getOpacity()).to.equal(0.0)
        w.setOpacity(0.5)
        expect(w.getOpacity()).to.equal(0.5)
        w.setOpacity(1.0)
        expect(w.getOpacity()).to.equal(1.0)
      })
    })
  })

  describe('"useContentSize" option', () => {
    it('make window created with content size when used', () => {
      w.destroy()
      w = new BrowserWindow({
        show: false,
        width: 400,
        height: 400,
        useContentSize: true
      })
      const contentSize = w.getContentSize()
      expect(contentSize[0]).to.equal(400)
      expect(contentSize[1]).to.equal(400)
    })

    it('make window created with window size when not used', () => {
      const size = w.getSize()
      expect(size[0]).to.equal(400)
      expect(size[1]).to.equal(400)
    })

    it('works for a frameless window', () => {
      w.destroy()
      w = new BrowserWindow({
        show: false,
        frame: false,
        width: 400,
        height: 400,
        useContentSize: true
      })
      const contentSize = w.getContentSize()
      expect(contentSize[0]).to.equal(400)
      expect(contentSize[1]).to.equal(400)
      const size = w.getSize()
      expect(size[0]).to.equal(400)
      expect(size[1]).to.equal(400)
    })
  })

  describe('"titleBarStyle" option', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }

      if (parseInt(os.release().split('.')[0]) < 14) {
        this.skip()
      }
    })

    it('creates browser window with hidden title bar', () => {
      w.destroy()
      w = new BrowserWindow({
        show: false,
        width: 400,
        height: 400,
        titleBarStyle: 'hidden'
      })
      const contentSize = w.getContentSize()
      expect(contentSize[1]).to.equal(400)
    })

    it('creates browser window with hidden inset title bar', () => {
      w.destroy()
      w = new BrowserWindow({
        show: false,
        width: 400,
        height: 400,
        titleBarStyle: 'hiddenInset'
      })
      const contentSize = w.getContentSize()
      expect(contentSize[1]).to.equal(400)
    })
  })

  describe('enableLargerThanScreen" option', () => {
    before(function () {
      if (process.platform === 'linux') {
        this.skip()
      }
    })

    beforeEach(() => {
      w.destroy()
      w = new BrowserWindow({
        show: true,
        width: 400,
        height: 400,
        enableLargerThanScreen: true
      })
    })

    it('can move the window out of screen', () => {
      w.setPosition(-10, -10)
      const after = w.getPosition()
      expect(after[0]).to.equal(-10)
      expect(after[1]).to.equal(-10)
    })

    it('can set the window larger than screen', () => {
      const size = screen.getPrimaryDisplay().size
      size.width += 100
      size.height += 100
      w.setSize(size.width, size.height)
      assertBoundsEqual(w.getSize(), [size.width, size.height])
    })
  })

  describe('"zoomToPageWidth" option', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('sets the window width to the page width when used', () => {
      w.destroy()
      w = new BrowserWindow({
        show: false,
        width: 500,
        height: 400,
        zoomToPageWidth: true
      })
      w.maximize()
      expect(w.getSize()[0]).to.equal(500)
    })
  })

  describe('"tabbingIdentifier" option', () => {
    it('can be set on a window', () => {
      w.destroy()
      w = new BrowserWindow({
        tabbingIdentifier: 'group1'
      })
      w.destroy()
      w = new BrowserWindow({
        tabbingIdentifier: 'group2',
        frame: false
      })
    })
  })

  describe('"webPreferences" option', () => {
    afterEach(() => { ipcMain.removeAllListeners('answer') })

    describe('"preload" option', () => {
      it('loads the script before other scripts in window', done => {
        const preload = path.join(fixtures, 'module', 'set-global.js')
        ipcMain.once('answer', (event, test) => {
          expect(test).to.equal('preload')
          done()
        })
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preload
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'preload.html')}`)
      })

      it('can successfully delete the Buffer global', done => {
        const preload = path.join(fixtures, 'module', 'delete-buffer.js')
        ipcMain.once('answer', (event, test) => {
          expect(test.toString()).to.equal('buffer')
          done()
        })
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preload
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'preload.html')}`)
      })
    })

    describe('session preload scripts', () => {
      const preloads = [
        path.join(fixtures, 'module', 'set-global-preload-1.js'),
        path.join(fixtures, 'module', 'set-global-preload-2.js')
      ]
      const defaultSession = session.defaultSession

      beforeEach(() => {
        expect(defaultSession.getPreloads()).to.deep.equal([])
        defaultSession.setPreloads(preloads)
      })

      afterEach(() => {
        defaultSession.setPreloads([])
      })

      it('can set multiple session preload script', () => {
        expect(defaultSession.getPreloads()).to.deep.equal(preloads)
      })

      it('loads the script before other scripts in window including normal preloads', done => {
        ipcMain.once('vars', (event, preload1, preload2, preload3) => {
          expect(preload1).to.equal('preload-1')
          expect(preload2).to.equal('preload-1-2')
          expect(preload3).equal('preload-1-2-3')
          done()
        })

        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: path.join(fixtures, 'module', 'set-global-preload-3.js')
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'preloads.html')}`)
      })
    })

    describe('"additionalArguments" option', () => {
      it('adds extra args to process.argv in the renderer process', done => {
        const preload = path.join(fixtures, 'module', 'check-arguments.js')
        ipcMain.once('answer', (event, argv) => {
          expect(argv).to.include('--my-magic-arg')
          done()
        })
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preload,
            additionalArguments: ['--my-magic-arg']
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'blank.html')}`)
      })

      it('adds extra value args to process.argv in the renderer process', done => {
        const preload = path.join(fixtures, 'module', 'check-arguments.js')
        ipcMain.once('answer', (event, argv) => {
          expect(argv).to.include('--my-magic-arg=foo')
          done()
        })

        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preload,
            additionalArguments: ['--my-magic-arg=foo']
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'blank.html')}`)
      })
    })

    describe('"node-integration" option', () => {
      it('disables node integration when specified to false', done => {
        const preload = path.join(fixtures, 'module', 'send-later.js')
        ipcMain.once('answer', (event, typeofProcess, typeofBuffer) => {
          expect(typeofProcess).to.equal('undefined')
          expect(typeofBuffer).to.equal('undefined')
          done()
        })

        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preload,
            nodeIntegration: false
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'blank.html')}`)
      })
    })

    describe('"sandbox" option', () => {
      function waitForEvents (emitter, events, callback) {
        let count = events.length
        for (let event of events) {
          emitter.once(event, () => {
            if (!--count) callback()
          })
        }
      }

      const preload = path.join(fixtures, 'module', 'preload-sandbox.js')

      // http protocol to simulate accessing another domain. This is required
      // because the code paths for cross domain popups is different.
      function crossDomainHandler (request, callback) {
        // Disabled due to false positive in StandardJS
        // eslint-disable-next-line standard/no-callback-literal
        callback({
          mimeType: 'text/html',
          data: `<html><body><h1>${request.url}</h1></body></html>`
        })
      }

      before(done => {
        protocol.interceptStringProtocol('http', crossDomainHandler, () => {
          done()
        })
      })

      after(done => {
        protocol.uninterceptProtocol('http', () => {
          done()
        })
      })

      it('exposes ipcRenderer to preload script', done => {
        ipcMain.once('answer', (event, test) => {
          expect(test).to.equal('preload')
          done()
        })

        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            preload: preload
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'preload.html')}`)
      })

      it('exposes ipcRenderer to preload script (path has special chars)', done => {
        const preloadSpecialChars = path.join(fixtures, 'module', 'preload-sandboxæø åü.js')
        ipcMain.once('answer', (event, test) => {
          expect(test).to.equal('preload')
          done()
        })
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            preload: preloadSpecialChars
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'preload.html')}`)
      })

      it('exposes "exit" event to preload script', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            preload: preload
          }
        })
        let htmlPath = path.join(fixtures, 'api', 'sandbox.html?exit-event')
        const pageUrl = `file://${htmlPath}`

        w.loadURL(pageUrl)
        ipcMain.once('answer', (event, url) => {
          let expectedUrl = pageUrl
          if (process.platform === 'win32') {
            expectedUrl = `file:///${htmlPath.replace(/\\/g, '/')}`
          }
          expect(url).to.equal(expectedUrl)
          done()
        })
      })

      it('should open windows in same domain with cross-scripting enabled', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            preload: preload
          }
        })

        ipcRenderer.send('set-web-preferences-on-next-new-window', w.webContents.id, 'preload', preload)
        let htmlPath = path.join(fixtures, 'api', 'sandbox.html?window-open')
        const pageUrl = `file://${htmlPath}`
        w.loadURL(pageUrl)

        w.webContents.once('new-window', (e, url, frameName, disposition, options) => {
          let expectedUrl = pageUrl
          if (process.platform === 'win32') {
            expectedUrl = `file:///${htmlPath.replace(/\\/g, '/')}`
          }
          expect(url).to.equal(expectedUrl)
          expect(frameName).to.equal('popup!')
          expect(options.width).to.equal(500)
          expect(options.height).to.equal(600)

          ipcMain.once('answer', (event, html) => {
            expect(html).equal('<h1>scripting from opener</h1>')
            done()
          })
        })
      })

      it('should open windows in another domain with cross-scripting disabled', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            preload: preload
          }
        })

        ipcRenderer.send('set-web-preferences-on-next-new-window', w.webContents.id, 'preload', preload)
        let htmlPath = path.join(fixtures, 'api', 'sandbox.html?window-open-external')
        const pageUrl = `file://${htmlPath}`
        let popupWindow
        w.loadURL(pageUrl)

        w.webContents.once('new-window', (e, url, frameName, disposition, options) => {
          expect(url).to.equal('http://www.google.com/#q=electron')
          expect(options.width).to.equal(505)
          expect(options.height).to.equal(605)

          ipcMain.once('child-loaded', (event, openerIsNull, html) => {
            expect(openerIsNull).to.be.true()
            expect(html).to.equal('<h1>http://www.google.com/#q=electron</h1>')
            ipcMain.once('answer', (event, exceptionMessage) => {
              expect(/Blocked a frame with origin/.test(exceptionMessage)).to.be.true()

              // FIXME this popup window should be closed in sandbox.html
              closeWindow(popupWindow, {assertSingleWindow: false}).then(() => {
                popupWindow = null
                done()
              })
            })
            w.webContents.send('child-loaded')
          })
        })

        app.once('browser-window-created', (event, window) => {
          popupWindow = window
        })
      })

      it('should inherit the sandbox setting in opened windows', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true
          }
        })

        const preloadPath = path.join(fixtures, 'api', 'new-window-preload.js')
        ipcRenderer.send('set-web-preferences-on-next-new-window', w.webContents.id, 'preload', preloadPath)
        ipcMain.once('answer', (event, args) => {
          expect(args).to.include('--enable-sandbox')
          done()
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'new-window.html')}`)
      })

      it('should open windows with the options configured via new-window event listeners', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true
          }
        })

        const preloadPath = path.join(fixtures, 'api', 'new-window-preload.js')
        ipcRenderer.send('set-web-preferences-on-next-new-window', w.webContents.id, 'preload', preloadPath)
        ipcRenderer.send('set-web-preferences-on-next-new-window', w.webContents.id, 'foo', 'bar')
        ipcMain.once('answer', (event, args, webPreferences) => {
          expect(webPreferences.foo).to.equal('bar')
          done()
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'new-window.html')}`)
      })

      it('should set ipc event sender correctly', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            preload: preload
          }
        })

        let htmlPath = path.join(fixtures, 'api', 'sandbox.html?verify-ipc-sender')
        const pageUrl = `file://${htmlPath}`
        let childWc

        w.webContents.once('new-window', (e, url, frameName, disposition, options) => {
          childWc = options.webContents
          expect(w.webContents).to.not.equal(childWc)
        })

        ipcMain.once('parent-ready', event => {
          expect(w.webContents).to.equal(event.sender)
          event.sender.send('verified')
        })

        ipcMain.once('child-ready', event => {
          expect(childWc).to.exist()
          expect(childWc).to.equal(event.sender)
          event.sender.send('verified')
        })

        waitForEvents(ipcMain, [
          'parent-answer',
          'child-answer'
        ], done)
        w.loadURL(pageUrl)
      })

      describe('event handling', () => {
        it('works for window events', done => {
          waitForEvents(w, [
            'page-title-updated'
          ], done)
          w.loadURL(`file://${path.join(fixtures, 'api', 'sandbox.html?window-events')}`)
        })

        it('works for stop events', done => {
          waitForEvents(w.webContents, [
            'did-navigate',
            'did-fail-load',
            'did-stop-loading'
          ], done)
          w.loadURL(`file://${path.join(fixtures, 'api', 'sandbox.html?webcontents-stop')}`)
        })

        it('works for web contents events', done => {
          waitForEvents(w.webContents, [
            'did-finish-load',
            'did-frame-finish-load',
            'did-navigate-in-page',
            'will-navigate',
            'did-start-loading',
            'did-stop-loading',
            'did-frame-finish-load',
            'dom-ready'
          ], done)
          w.loadURL(`file://${path.join(fixtures, 'api', 'sandbox.html?webcontents-events')}`)
        })
      })

      it('can get printer list', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            preload: preload
          }
        })

        w.loadURL('data:text/html,%3Ch1%3EHello%2C%20World!%3C%2Fh1%3E')
        w.webContents.once('did-finish-load', () => {
          const printers = w.webContents.getPrinters()
          expect(printers).to.be.an('array')
          done()
        })
      })

      it('can print to PDF', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            preload: preload
          }
        })

        w.loadURL('data:text/html,%3Ch1%3EHello%2C%20World!%3C%2Fh1%3E')
        w.webContents.once('did-finish-load', () => {
          w.webContents.printToPDF({}, (error, data) => {
            expect(error).to.be.null()
            expect(data).to.be.an.instanceOf('Buffer')
            expect(data.length).to.not.equal(0)
            done()
          })
        })
      })

      it('supports calling preventDefault on new-window events', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true
          }
        })

        const initialWebContents = webContents.getAllWebContents().map((i) => i.id)
        ipcRenderer.send('prevent-next-new-window', w.webContents.id)
        w.webContents.once('new-window', () => {
          // We need to give it some time so the windows get properly disposed (at least on OSX).
          setTimeout(() => {
            const currentWebContents = webContents.getAllWebContents().map((i) => i.id)
            expect(currentWebContents).to.deep.equal(initialWebContents)
            done()
          }, 100)
        })
        w.loadURL(`file://${path.join(fixtures, 'pages', 'window-open.html')}`)
      })

      it('releases memory after popup is closed', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preload,
            sandbox: true
          }
        })

        w.loadURL(`file://${path.join(fixtures, 'api', 'sandbox.html?allocate-memory')}`)
        ipcMain.once('answer', (event, {bytesBeforeOpen, bytesAfterOpen, bytesAfterClose}) => {
          const memoryIncreaseByOpen = bytesAfterOpen - bytesBeforeOpen
          const memoryDecreaseByClose = bytesAfterOpen - bytesAfterClose
          // decreased memory should be less than increased due to factors we
          // can't control, but given the amount of memory allocated in the
          // fixture, we can reasonably expect decrease to be at least 70% of
          // increase
          expect(memoryDecreaseByClose > memoryIncreaseByOpen * 0.7).to.be.true()
          done()
        })
      })

      // see #9387
      it('properly manages remote object references after page reload', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preload,
            sandbox: true
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'sandbox.html?reload-remote')}`)

        ipcMain.on('get-remote-module-path', event => {
          event.returnValue = path.join(fixtures, 'module', 'hello.js')
        })

        let reload = false
        ipcMain.on('reloaded', event => {
          event.returnValue = reload
          reload = !reload
        })

        ipcMain.once('reload', event => {
          event.sender.reload()
        })

        ipcMain.once('answer', (event, arg) => {
          ipcMain.removeAllListeners('reloaded')
          ipcMain.removeAllListeners('get-remote-module-path')
          expect(arg).to.equal('hi')
          done()
        })
      })

      it('properly manages remote object references after page reload in child window', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: preload,
            sandbox: true
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'sandbox.html?reload-remote-child')}`)

        ipcMain.on('get-remote-module-path', event => {
          event.returnValue = path.join(fixtures, 'module', 'hello-child.js')
        })

        let reload = false
        ipcMain.on('reloaded', event => {
          event.returnValue = reload
          reload = !reload
        })

        ipcMain.once('reload', event => {
          event.sender.reload()
        })

        ipcMain.once('answer', (event, arg) => {
          ipcMain.removeAllListeners('reloaded')
          ipcMain.removeAllListeners('get-remote-module-path')
          expect(arg).to.equal('hi child window')
          done()
        })
      })

      it('validate process.env access in sandbox renderer', done => {
        ipcMain.once('answer', (event, test) => {
          expect(test).to.equal('foo')
          done()
        })

        remote.process.env.sandboxmain = 'foo'
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            preload: preload
          }
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'preload.html')}`)
      })
    })

    describe('nativeWindowOpen option', () => {
      beforeEach(() => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            nativeWindowOpen: true
          }
        })
      })

      it('opens window of about:blank with cross-scripting enabled', done => {
        ipcMain.once('answer', (event, content) => {
          expect(content).to.equal('Hello')
          done()
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'native-window-open-blank.html')}`)
      })

      it('opens window of same domain with cross-scripting enabled', done => {
        ipcMain.once('answer', (event, content) => {
          expect(content).to.equal('Hello')
          done()
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'native-window-open-file.html')}`)
      })

      it('blocks accessing cross-origin frames', done => {
        ipcMain.once('answer', (event, content) => {
          expect(content).to.equal('Blocked a frame with origin "file://" from accessing a cross-origin frame.')
          done()
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'native-window-open-cross-origin.html')}`)
      })

      it('opens window from <iframe> tags', done => {
        ipcMain.once('answer', (event, content) => {
          expect(content).to.equal('Hello')
          done()
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'native-window-open-iframe.html')}`)
      })

      it('loads native addons correctly after reload', done => {
        if (!nativeModulesEnabled) return done()

        ipcMain.once('answer', (event, content) => {
          expect(content).to.equal('function')
          ipcMain.once('answer', (event, content) => {
            expect(content).to.equal('function')
            done()
          })
          w.reload()
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'native-window-open-native-addon.html')}`)
      })

      it('should inherit the nativeWindowOpen setting in opened windows', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            nativeWindowOpen: true
          }
        })

        const preloadPath = path.join(fixtures, 'api', 'new-window-preload.js')
        ipcRenderer.send('set-web-preferences-on-next-new-window', w.webContents.id, 'preload', preloadPath)
        ipcMain.once('answer', (event, args) => {
          expect(args).to.include('--native-window-open')
          done()
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'new-window.html')}`)
      })

      it('should open windows with the options configured via new-window event listeners', done => {
        w.destroy()
        w = new BrowserWindow({
          show: false,
          webPreferences: {
            nativeWindowOpen: true
          }
        })

        const preloadPath = path.join(fixtures, 'api', 'new-window-preload.js')
        ipcRenderer.send('set-web-preferences-on-next-new-window', w.webContents.id, 'preload', preloadPath)
        ipcRenderer.send('set-web-preferences-on-next-new-window', w.webContents.id, 'foo', 'bar')
        ipcMain.once('answer', (event, args, webPreferences) => {
          expect(webPreferences.foo).to.equal('bar')
          done()
        })
        w.loadURL(`file://${path.join(fixtures, 'api', 'new-window.html')}`)
      })

      it('retains the original web preferences when window.location is changed to a new origin', async () => {
        await serveFileFromProtocol('foo', path.join(fixtures, 'api', 'window-open-location-change.html'))
        await serveFileFromProtocol('bar', path.join(fixtures, 'api', 'window-open-location-final.html'))

        w.destroy()
        w = new BrowserWindow({
          show: true,
          webPreferences: {
            nodeIntegration: false,
            nativeWindowOpen: true
          }
        })

        return new Promise((resolve, reject) => {
          ipcRenderer.send('set-web-preferences-on-next-new-window', w.webContents.id, 'preload', path.join(fixtures, 'api', 'window-open-preload.js'))
          ipcMain.once('answer', (event, args, typeofProcess) => {
            expect(args).to.include('--node-integration=false')
            expect(args).to.include('--native-window-open')
            expect(typeofProcess).to.equal('undefined')
            resolve()
          })
          w.loadURL(`file://${path.join(fixtures, 'api', 'window-open-location-open.html')}`)
        })
      })
    })
  })

  describe('nativeWindowOpen + contextIsolation options', () => {
    beforeEach(() => {
      w.destroy()
      w = new BrowserWindow({
        show: false,
        webPreferences: {
          nativeWindowOpen: true,
          contextIsolation: true,
          preload: path.join(fixtures, 'api', 'native-window-open-isolated-preload.js')
        }
      })
    })

    it('opens window with cross-scripting enabled from isolated context', done => {
      ipcMain.once('answer', (event, content) => {
        expect(content).to.equal('Hello')
        done()
      })
      w.loadURL(`file://${path.join(fixtures, 'api', 'native-window-open-isolated.html')}`)
    })
  })

  describe('beforeunload handler', () => {
    it('returning undefined would not prevent close', done => {
      w.once('closed', () => { done() })
      w.loadURL(`file://${path.join(fixtures, 'api', 'close-beforeunload-undefined.html')}`)
    })

    it('returning false would prevent close', done => {
      w.once('onbeforeunload', () => { done() })
      w.loadURL(`file://${path.join(fixtures, 'api', 'close-beforeunload-false.html')}`)
    })

    it('returning empty string would prevent close', done => {
      w.once('onbeforeunload', () => { done() })
      w.loadURL(`file://${path.join(fixtures, 'api', 'close-beforeunload-empty-string.html')}`)
    })

    it('emits for each close attempt', done => {
      let beforeUnloadCount = 0
      w.on('onbeforeunload', () => {
        beforeUnloadCount += 1
        if (beforeUnloadCount < 3) {
          w.close()
        } else if (beforeUnloadCount === 3) {
          done()
        }
      })
      w.webContents.once('did-finish-load', () => { w.close() })
      w.loadURL(`file://${path.join(fixtures, 'api', 'beforeunload-false-prevent3.html')}`)
    })

    it('emits for each reload attempt', done => {
      let beforeUnloadCount = 0
      w.on('onbeforeunload', () => {
        beforeUnloadCount += 1
        if (beforeUnloadCount < 3) {
          w.reload()
        } else if (beforeUnloadCount === 3) {
          done()
        }
      })
      w.webContents.once('did-finish-load', () => {
        w.webContents.once('did-finish-load', () => {
          expect.fail('Reload was not prevented')
        })
        w.reload()
      })
      w.loadURL(`file://${path.join(fixtures, 'api', 'beforeunload-false-prevent3.html')}`)
    })

    it('emits for each navigation attempt', done => {
      let beforeUnloadCount = 0
      w.on('onbeforeunload', () => {
        beforeUnloadCount += 1
        if (beforeUnloadCount < 3) {
          w.loadURL('about:blank')
        } else if (beforeUnloadCount === 3) {
          done()
        }
      })
      w.webContents.once('did-finish-load', () => {
        w.webContents.once('did-finish-load', () => {
          expect.fail('Navigation was not prevented')
        })
        w.loadURL('about:blank')
      })
      w.loadURL(`file://${path.join(fixtures, 'api', 'beforeunload-false-prevent3.html')}`)
    })
  })

  describe('document.visibilityState/hidden', () => {
    beforeEach(() => { w.destroy() })

    function onVisibilityChange (callback) {
      ipcMain.on('pong', (event, visibilityState, hidden) => {
        if (event.sender.id === w.webContents.id) {
          callback(visibilityState, hidden)
        }
      })
    }

    function onNextVisibilityChange (callback) {
      ipcMain.once('pong', (event, visibilityState, hidden) => {
        if (event.sender.id === w.webContents.id) {
          callback(visibilityState, hidden)
        }
      })
    }

    afterEach(() => { ipcMain.removeAllListeners('pong') })

    it('visibilityState is initially visible despite window being hidden', done => {
      w = new BrowserWindow({ show: false, width: 100, height: 100 })

      let readyToShow = false
      w.once('ready-to-show', () => {
        readyToShow = true
      })

      onNextVisibilityChange((visibilityState, hidden) => {
        expect(readyToShow).to.be.false()
        expect(visibilityState).to.equal('visible')
        expect(hidden).to.be.false()

        done()
      })

      w.loadURL(`file://${path.join(fixtures, 'pages', 'visibilitychange.html')}`)
    })

    it('visibilityState changes when window is hidden', done => {
      w = new BrowserWindow({width: 100, height: 100})

      onNextVisibilityChange((visibilityState, hidden) => {
        expect(visibilityState).to.equal('visible')
        expect(hidden).to.be.false()

        onNextVisibilityChange((visibilityState, hidden) => {
          expect(visibilityState).to.equal('hidden')
          expect(hidden).to.be.true()
          done()
        })

        w.hide()
      })

      w.loadURL(`file://${path.join(fixtures, 'pages', 'visibilitychange.html')}`)
    })

    it('visibilityState changes when window is shown', done => {
      w = new BrowserWindow({width: 100, height: 100})

      onNextVisibilityChange((visibilityState, hidden) => {
        onVisibilityChange((visibilityState, hidden) => {
          if (!hidden) {
            expect(visibilityState).to.equal('visible')
            done()
          }
        })

        w.hide()
        w.show()
      })

      w.loadURL(`file://${path.join(fixtures, 'pages', 'visibilitychange.html')}`)
    })

    it('visibilityState changes when window is shown inactive', done => {
      if (isCI && process.platform === 'win32') {
        // FIXME(alexeykuzmin): Skip the test instead of marking it as passed.
        // afterEach hook won't be run if a test is skipped dynamically.
        // If afterEach isn't run current window won't be destroyed
        // and the next test will fail on assertion in `closeWindow()`.
        // this.skip()
        return done()
      }

      w = new BrowserWindow({width: 100, height: 100})

      onNextVisibilityChange((visibilityState, hidden) => {
        onVisibilityChange((visibilityState, hidden) => {
          if (!hidden) {
            expect(visibilityState).to.equal('visible')
            done()
          }
        })

        w.hide()
        w.showInactive()
      })

      w.loadURL(`file://${path.join(fixtures, 'pages', 'visibilitychange.html')}`)
    })

    it('visibilityState changes when window is minimized', done => {
      if (isCI && process.platform === 'linux') {
        // FIXME(alexeykuzmin): Skip the test instead of marking it as passed.
        // afterEach hook won't be run if a test is skipped dynamically.
        // If afterEach isn't run current window won't be destroyed
        // and the next test will fail on assertion in `closeWindow()`.
        // this.skip()
        return done()
      }

      w = new BrowserWindow({width: 100, height: 100})

      onNextVisibilityChange((visibilityState, hidden) => {
        expect(visibilityState).to.equal('visible')
        expect(hidden).to.be.false()

        onNextVisibilityChange((visibilityState, hidden) => {
          expect(visibilityState).to.equal('hidden')
          expect(hidden).to.be.true()
          done()
        })

        w.minimize()
      })

      w.loadURL(`file://${path.join(fixtures, 'pages', 'visibilitychange.html')}`)
    })

    it('visibilityState remains visible if backgroundThrottling is disabled', done => {
      w = new BrowserWindow({
        show: false,
        width: 100,
        height: 100,
        webPreferences: {
          backgroundThrottling: false
        }
      })

      onNextVisibilityChange((visibilityState, hidden) => {
        expect(visibilityState).to.equal('visible')
        expect(hidden).to.be.false()

        onNextVisibilityChange((visibilityState, hidden) => {
          done(new Error(`Unexpected visibility change event. visibilityState: ${visibilityState} hidden: ${hidden}`))
        })
      })

      w.once('show', () => {
        w.once('hide', () => {
          w.once('show', () => {
            done()
          })
          w.show()
        })
        w.hide()
      })
      w.show()

      w.loadURL(`file://${path.join(fixtures, 'pages', 'visibilitychange.html')}`)
    })
  })

  describe('new-window event', () => {
    before(function () {
      if (isCI && process.platform === 'darwin') {
        this.skip()
      }
    })

    it('emits when window.open is called', done => {
      w.webContents.once('new-window', (e, url, frameName, disposition, options, additionalFeatures) => {
        e.preventDefault()
        expect(url).to.equal('http://host/')
        expect(frameName).to.equal('host')
        expect(additionalFeatures[0]).to.equal('this-is-not-a-standard-feature')
        done()
      })
      w.loadURL(`file://${fixtures}/pages/window-open.html`)
    })

    it('emits when window.open is called with no webPreferences', done => {
      w.destroy()
      w = new BrowserWindow({ show: false })
      w.webContents.once('new-window', (e, url, frameName, disposition, options, additionalFeatures) => {
        e.preventDefault()
        expect(url).to.equal('http://host/')
        expect(frameName).to.equal('host')
        expect(additionalFeatures[0]).to.equal('this-is-not-a-standard-feature')
        done()
      })
      w.loadURL(`file://${fixtures}/pages/window-open.html`)
    })

    it('emits when link with target is called', done => {
      w.webContents.once('new-window', (e, url, frameName) => {
        e.preventDefault()
        expect(url).to.equal('http://host/')
        expect(frameName).to.equal('target')
        done()
      })
      w.loadURL(`file://${fixtures}/pages/target-name.html`)
    })
  })

  describe('maximize event', () => {
    if (isCI) return

    it('emits when window is maximized', done => {
      w.once('maximize', () => { done() })
      w.show()
      w.maximize()
    })
  })

  describe('unmaximize event', () => {
    if (isCI) return

    it('emits when window is unmaximized', done => {
      w.once('unmaximize', () => { done() })
      w.show()
      w.maximize()
      w.unmaximize()
    })
  })

  describe('minimize event', () => {
    if (isCI) return

    it('emits when window is minimized', done => {
      w.once('minimize', () => { done() })
      w.show()
      w.minimize()
    })
  })

  describe('sheet-begin event', () => {
    let sheet = null

    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    afterEach(() => {
      return closeWindow(sheet, {assertSingleWindow: false}).then(() => { sheet = null })
    })

    it('emits when window opens a sheet', done => {
      w.show()
      w.once('sheet-begin', () => {
        sheet.close()
        done()
      })
      sheet = new BrowserWindow({
        modal: true,
        parent: w
      })
    })
  })

  describe('sheet-end event', () => {
    let sheet = null

    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    afterEach(() => {
      return closeWindow(sheet, {assertSingleWindow: false}).then(() => { sheet = null })
    })

    it('emits when window has closed a sheet', done => {
      w.show()
      sheet = new BrowserWindow({
        modal: true,
        parent: w
      })
      w.once('sheet-end', () => { done() })
      sheet.close()
    })
  })

  describe('beginFrameSubscription method', () => {
    before(function () {
      // This test is too slow, only test it on CI.
      if (!isCI) {
        this.skip()
      }

      // FIXME These specs crash on Linux when run in a docker container
      if (isCI && process.platform === 'linux') {
        this.skip()
      }
    })

    it('subscribes to frame updates', done => {
      let called = false
      w.loadURL(`file://${fixtures}/api/frame-subscriber.html`)
      w.webContents.on('dom-ready', () => {
        w.webContents.beginFrameSubscription(data => {
          // This callback might be called twice.
          if (called) return
          called = true

          expect(data.length).to.not.equal(0)
          w.webContents.endFrameSubscription()
          done()
        })
      })
    })

    it('subscribes to frame updates (only dirty rectangle)', done => {
      let called = false
      w.loadURL(`file://${fixtures}/api/frame-subscriber.html`)
      w.webContents.on('dom-ready', () => {
        w.webContents.beginFrameSubscription(true, data => {
          // This callback might be called twice.
          if (called) return
          called = true

          expect(data.length).to.not.equal(0)
          w.webContents.endFrameSubscription()
          done()
        })
      })
    })

    it('throws error when subscriber is not well defined', done => {
      w.loadURL(`file://${fixtures}'/api/frame-subscriber.html`)
      try {
        w.webContents.beginFrameSubscription(true, true)
      } catch (e) {
        done()
      }
    })
  })

  describe('savePage method', () => {
    const savePageDir = path.join(fixtures, 'save_page')
    const savePageHtmlPath = path.join(savePageDir, 'save_page.html')
    const savePageJsPath = path.join(savePageDir, 'save_page_files', 'test.js')
    const savePageCssPath = path.join(savePageDir, 'save_page_files', 'test.css')

    after(() => {
      try {
        fs.unlinkSync(savePageCssPath)
        fs.unlinkSync(savePageJsPath)
        fs.unlinkSync(savePageHtmlPath)
        fs.rmdirSync(path.join(savePageDir, 'save_page_files'))
        fs.rmdirSync(savePageDir)
      } catch (e) {
        // Ignore error
      }
    })

    it('should save page to disk', done => {
      w.webContents.on('did-finish-load', () => {
        w.webContents.savePage(savePageHtmlPath, 'HTMLComplete', error => {
          expect(error).to.be.null()
          expect(fs.existsSync(savePageHtmlPath)).to.be.true()
          expect(fs.existsSync(savePageJsPath)).to.be.true()
          expect(fs.existsSync(savePageCssPath)).to.be.true()
          done()
        })
      })
      w.loadURL('file://' + fixtures + '/pages/save_page/index.html')
    })
  })

  describe('BrowserWindow options argument is optional', () => {
    it('should create a window with default size (800x600)', () => {
      w.destroy()
      w = new BrowserWindow()
      const size = w.getSize()
      expect(size[0]).to.equal(800)
      expect(size[1]).to.equal(600)
    })
  })

  describe('window states', () => {
    it('does not resize frameless windows when states change', () => {
      w.destroy()
      w = new BrowserWindow({
        frame: false,
        width: 300,
        height: 200,
        show: false
      })

      w.setMinimizable(false)
      w.setMinimizable(true)
      expect(w.getSize()).to.deep.equal([300, 200])

      w.setResizable(false)
      w.setResizable(true)
      expect(w.getSize()).to.deep.equal([300, 200])

      w.setMaximizable(false)
      w.setMaximizable(true)
      expect(w.getSize()).to.deep.equal([300, 200])

      w.setFullScreenable(false)
      w.setFullScreenable(true)
      expect(w.getSize()).to.deep.equal([300, 200])

      w.setClosable(false)
      w.setClosable(true)
      expect(w.getSize()).to.deep.equal([300, 200])
    })

    describe('resizable state', () => {
      it('can be changed with resizable option', () => {
        w.destroy()
        w = new BrowserWindow({show: false, resizable: false})
        expect(w.isResizable()).to.equal.false()

        if (process.platform === 'darwin') {
          expect(w.isResizable()).to.equal.true()
        }
      })

      it('can be changed with setResizable method', () => {
        expect(w.isResizable()).to.equal.true()
        w.setResizable(false)
        expect(w.isResizable()).to.equal.false()
        w.setResizable(true)
        expect(w.isResizable()).to.equal.false()
      })

      it('works for a frameless window', () => {
        w.destroy()
        w = new BrowserWindow({show: false, frame: false})
        expect(w.isResizable()).to.equal.true()

        if (process.platform === 'win32') {
          w.destroy()
          w = new BrowserWindow({show: false, thickFrame: false})
          expect(w.isResizable()).to.equal.false()
        }
      })

      if (process.platform === 'win32') {
        it('works for a window smaller than 64x64', () => {
          w.destroy()
          w = new BrowserWindow({
            show: false,
            frame: false,
            resizable: false,
            transparent: true
          })
          w.setContentSize(60, 60)
          assertBoundsEqual(w.getContentSize(), [60, 60])
          w.setContentSize(30, 30)
          assertBoundsEqual(w.getContentSize(), [30, 30])
          w.setContentSize(10, 10)
          assertBoundsEqual(w.getContentSize(), [10, 10])
        })
      }
    })

    describe('loading main frame state', () => {
      it('is true when the main frame is loading', done => {
        w.webContents.on('did-start-loading', () => {
          expect(w.webContents.isLoadingMainFrame()).to.be.true()
          done()
        })
        w.webContents.loadURL(server.url)
      })

      it('is false when only a subframe is loading', done => {
        w.webContents.once('did-finish-load', () => {
          expect(w.webContents.isLoadingMainFrame()).to.be.false()
          w.webContents.on('did-start-loading', () => {
            expect(w.webContents.isLoadingMainFrame()).to.be.true()
            done()
          })
          w.webContents.executeJavaScript(`
            var iframe = document.createElement('iframe')
            iframe.src = '${server.url}/page2'
            document.body.appendChild(iframe)
          `)
        })
        w.webContents.loadURL(server.url)
      })

      it('is true when navigating to pages from the same origin', done => {
        w.webContents.once('did-finish-load', () => {
          expect(w.webContents.isLoadingMainFrame()).to.be.false()
          w.webContents.on('did-start-loading', () => {
            expect(w.webContents.isLoadingMainFrame()).to.be.true()
            done()
          })
          w.webContents.loadURL(`${server.url}/page2`)
        })
        w.webContents.loadURL(server.url)
      })
    })
  })

  describe('window states (excluding Linux)', () => {
    // FIXME(alexeykuzmin): Skip the tests instead of using the `return` here.
    // Why it cannot be done now:
    // - `.skip()` called in the 'before' hook doesn't affect
    //     nested `describe`s.
    // - `.skip()` called in the 'beforeEach' hook prevents 'afterEach'
    //     hook from being called.
    // Not implemented on Linux.
    if (process.platform === 'linux') {
      return
    }

    describe('movable state', () => {
      it('can be changed with movable option', () => {
        w.destroy()
        w = new BrowserWindow({show: false, movable: false})
        expect(w.isMovable()).to.be.false()
      })

      it('can be changed with setMovable method', () => {
        expect(w.isMovable()).to.be.true()
        w.setMovable(false)
        expect(w.isMovable()).to.be.false()
        w.setMovable(true)
        expect(w.isMovable()).to.be.true()
      })
    })

    describe('minimizable state', () => {
      it('can be changed with minimizable option', () => {
        w.destroy()
        w = new BrowserWindow({show: false, minimizable: false})
        expect(w.isMinimizable()).to.be.false()
      })

      it('can be changed with setMinimizable method', () => {
        expect(w.isMinimizable()).to.be.true()
        w.setMinimizable(false)
        expect(w.isMinimizable()).to.be.false()
        w.setMinimizable(true)
        expect(w.isMinimizable()).to.be.true()
      })
    })

    describe('maximizable state', () => {
      it('can be changed with maximizable option', () => {
        w.destroy()
        w = new BrowserWindow({show: false, maximizable: false})
        expect(w.isMaximizable()).to.be.false()
      })

      it('can be changed with setMaximizable method', () => {
        expect(w.isMaximizable()).to.be.true()
        w.setMaximizable(false)
        expect(w.isMaximizable()).to.be.false()
        w.setMaximizable(true)
        expect(w.isMaximizable()).to.be.true()
      })

      it('is not affected when changing other states', () => {
        w.setMaximizable(false)
        expect(w.isMaximizable()).to.be.false()
        w.setMinimizable(false)
        expect(w.isMaximizable()).to.be.false()
        w.setClosable(false)
        expect(w.isMaximizable()).to.be.false()

        w.setMaximizable(true)
        expect(w.isMaximizable()).to.be.true()
        w.setClosable(true)
        expect(w.isMaximizable()).to.be.true()
        w.setFullScreenable(false)
        expect(w.isMaximizable()).to.be.true()
      })
    })

    describe('maximizable state (Windows only)', () => {
      // Only implemented on windows.
      if (process.platform !== 'win32') return

      it('is set to false when resizable state is set to false', () => {
        w.setResizable(false)
        expect(w.isMaximizable()).to.be.false()
      })
    })

    describe('fullscreenable state', () => {
      before(function () {
        // Only implemented on macOS.
        if (process.platform !== 'darwin') {
          this.skip()
        }
      })

      it('can be changed with fullscreenable option', () => {
        w.destroy()
        w = new BrowserWindow({show: false, fullscreenable: false})
        expect(w.isFullScreenable()).to.be.false()
      })

      it('can be changed with setFullScreenable method', () => {
        expect(w.isFullScreenable()).to.be.true()
        w.setFullScreenable(false)
        expect(w.isFullScreenable()).to.be.false()
        w.setFullScreenable(true)
        expect(w.isFullScreenable()).to.be.false()
      })
    })

    describe('kiosk state', () => {
      before(function () {
        // Only implemented on macOS.
        if (process.platform !== 'darwin') {
          this.skip()
        }
      })

      it('can be changed with setKiosk method', done => {
        w.destroy()
        w = new BrowserWindow()
        w.setKiosk(true)
        expect(w.isKiosk()).to.be.true()

        w.once('enter-full-screen', () => {
          w.setKiosk(false)
          expect(w.isKiosk()).to.be.false()
        })
        w.once('leave-full-screen', () => {
          done()
        })
      })
    })

    describe('fullscreen state with resizable set', () => {
      before(function () {
        // Only implemented on macOS.
        if (process.platform !== 'darwin') {
          this.skip()
        }
      })

      it('resizable flag should be set to true and restored', done => {
        w.destroy()
        w = new BrowserWindow({ resizable: false })
        w.once('enter-full-screen', () => {
          expect(w.isResizable()).to.be.true()
          w.setFullScreen(false)
        })
        w.once('leave-full-screen', () => {
          expect(w.isResizable()).to.be.false()
          done()
        })
        w.setFullScreen(true)
      })
    })

    describe('fullscreen state', () => {
      before(function () {
        // Only implemented on macOS.
        if (process.platform !== 'darwin') {
          this.skip()
        }
      })

      it('can be changed with setFullScreen method', done => {
        w.destroy()
        w = new BrowserWindow()
        w.once('enter-full-screen', () => {
          expect(w.isFullScreen()).to.be.true()
          w.setFullScreen(false)
        })
        w.once('leave-full-screen', () => {
          expect(w.isFullScreen()).to.be.false()
          done()
        })
        w.setFullScreen(true)
      })

      it('should not be changed by setKiosk method', done => {
        w.destroy()
        w = new BrowserWindow()
        w.once('enter-full-screen', () => {
          expect(w.isFullScreen()).to.be.true()
          w.setKiosk(true)
          w.setKiosk(false)
          expect(w.isFullScreen()).to.be.true()
          w.setFullScreen(false)
        })
        w.once('leave-full-screen', () => {
          expect(w.isFullScreen()).to.be.false()
          done()
        })
        w.setFullScreen(true)
      })
    })

    describe('closable state', () => {
      it('can be changed with closable option', () => {
        w.destroy()
        w = new BrowserWindow({show: false, closable: false})
        expect(w.isClosable()).to.be.false()
      })

      it('can be changed with setClosable method', () => {
        expect(w.isClosable()).to.be.true()
        w.setClosable(false)
        expect(w.isClosable()).to.be.false()
        w.setClosable(true)
        expect(w.isClosable()).to.be.true()
      })
    })

    describe('hasShadow state', () => {
      // On Window there is no shadow by default and it can not be changed
      // dynamically.
      it('can be changed with hasShadow option', () => {
        w.destroy()
        let hasShadow = process.platform !== 'darwin'
        w = new BrowserWindow({show: false, hasShadow: hasShadow})
        expect(w.hasShadow()).to.equal(hasShadow)
      })

      it('can be changed with setHasShadow method', () => {
        if (process.platform !== 'darwin') return

        expect(w.hasShadow()).to.be.true()
        w.setHasShadow(false)
        expect(w.hasShadow()).to.be.false()
        w.setHasShadow(true)
        expect(w.hasShadow()).to.be.true()
      })
    })
  })

  describe('BrowserWindow.restore()', () => {
    it('should restore the previous window size', () => {
      if (w != null) w.destroy()

      w = new BrowserWindow({
        minWidth: 800,
        width: 800
      })

      const initialSize = w.getSize()
      w.minimize()
      w.restore()
      assertBoundsEqual(w.getSize(), initialSize)
    })
  })

  describe('BrowserWindow.unmaximize()', () => {
    it('should restore the previous window position', () => {
      if (w != null) w.destroy()
      w = new BrowserWindow()

      const initialPosition = w.getPosition()
      w.maximize()
      w.unmaximize()
      assertBoundsEqual(w.getPosition(), initialPosition)
    })
  })

  describe('BrowserWindow.setFullScreen(false)', () => {
    before(function () {
      // only applicable to windows: https://github.com/electron/electron/issues/6036
      if (process.platform !== 'win32') {
        this.skip()
      }
    })

    it('should restore a normal visible window from a fullscreen startup state', done => {
      w.webContents.once('did-finish-load', () => {
        // start fullscreen and hidden
        w.setFullScreen(true)
        w.once('show', () => { w.setFullScreen(false) })
        w.once('leave-full-screen', () => {
          expect(w.isVisible()).to.be.true()
          expect(w.isFullScreen()).to.be.false()
          done()
        })
        w.show()
      })
      w.loadURL('about:blank')
    })

    it('should keep window hidden if already in hidden state', done => {
      w.webContents.once('did-finish-load', () => {
        w.once('leave-full-screen', () => {
          expect(w.isVisible()).to.be.false()
          expect(w.isFullScreen()).to.be.false()
          done()
        })
        w.setFullScreen(false)
      })
      w.loadURL('about:blank')
    })
  })

  describe('parent window', () => {
    let c = null

    beforeEach(() => {
      if (c != null) c.destroy()
      c = new BrowserWindow({show: false, parent: w})
    })

    afterEach(() => {
      if (c != null) c.destroy()
      c = null
    })

    describe('parent option', () => {
      it('sets parent window', () => {
        expect(c.getParentWindow()).to.equal(w)
      })

      it('adds window to child windows of parent', () => {
        expect(w.getChildWindows()).to.deep.equal([c])
      })

      it('removes from child windows of parent when window is closed', done => {
        c.once('closed', () => {
          expect(w.getChildWindows()).to.deepe.equal([])
          done()
        })
        c.close()
      })

      it('should not affect the show option', () => {
        expect(c.isVisible()).to.be.false()
        expect(c.getParentWindow().isVisible()).to.be.false()
      })
    })

    describe('win.setParentWindow(parent)', () => {
      before(function () {
        if (process.platform === 'win32') {
          this.skip()
        }
      })

      beforeEach(() => {
        if (c != null) c.destroy()
        c = new BrowserWindow({show: false})
      })

      it('sets parent window', () => {
        expect(w.getParentWindow()).to.be.null()
        expect(c.getParentWindow()).to.be.null()
        c.setParentWindow(w)
        expect(c.getParentWindow()).to.equal(w)
        c.setParentWindow(null)
        expect(c.getParentWindow()).to.be.null()
      })

      it('adds window to child windows of parent', () => {
        expect(w.getChildWindows()).to.deep.equal([])
        c.setParentWindow(w)
        expect(w.getChildWindows()).to.deep.equal([c])
        c.setParentWindow(null)
        expect(w.getChildWindows()).to.deep.equal([])
      })

      it('removes from child windows of parent when window is closed', done => {
        c.once('closed', () => {
          expect(w.getChildWindows()).to.deep.equal([])
          done()
        })
        c.setParentWindow(w)
        c.close()
      })
    })

    describe('modal option', () => {
      before(function () {
        // The isEnabled API is not reliable on macOS.
        if (process.platform === 'darwin') {
          this.skip()
        }
      })

      beforeEach(() => {
        if (c != null) c.destroy()
        c = new BrowserWindow({show: false, parent: w, modal: true})
      })

      it('disables parent window', () => {
        expect(w.isEnabled()).to.be.true()
        c.show()
        expect(w.isEnabled()).to.be.false()
      })

      it('enables parent window when closed', done => {
        c.once('closed', () => {
          expect(w.isEnabled()).to.be.true()
          done()
        })
        c.show()
        c.close()
      })

      it('disables parent window recursively', () => {
        let c2 = new BrowserWindow({show: false, parent: w, modal: true})
        c.show()
        expect(w.isEnabled()).to.be.false()

        c2.show()
        expect(w.isEnabled()).to.be.false()

        c.destroy()
        expect(w.isEnabled()).to.be.false()

        c2.destroy()
        expect(w.isEnabled()).to.be.true()
      })
    })
  })

  describe('window.webContents.send(channel, args...)', () => {
    it('throws an error when the channel is missing', () => {
      expect(() => {
        w.webContents.send()
      }).to.throw('Missing required channel argument')

      expect(() => {
        w.webContents.send(null)
      }).to.throw('Missing required channel argument')
    })
  })

  describe('extensions and dev tools extensions', () => {
    let showPanelTimeoutId

    const showLastDevToolsPanel = () => {
      w.webContents.once('devtools-opened', () => {
        const show = () => {
          if (w == null || w.isDestroyed()) return
          const {devToolsWebContents} = w
          if (devToolsWebContents == null || devToolsWebContents.isDestroyed()) {
            return
          }

          const showLastPanel = () => {
            const lastPanelId = UI.inspectorView._tabbedPane._tabs.peekLast().id
            UI.inspectorView.showPanel(lastPanelId)
          }
          devToolsWebContents.executeJavaScript(`(${showLastPanel})()`, false, () => {
            showPanelTimeoutId = setTimeout(show, 100)
          })
        }
        showPanelTimeoutId = setTimeout(show, 100)
      })
    }

    afterEach(() => {
      clearTimeout(showPanelTimeoutId)
    })

    describe('BrowserWindow.addDevToolsExtension', () => {
      describe('for invalid extensions', () => {
        it('throws errors for missing manifest.json files', () => {
          const nonexistentExtensionPath = path.join(__dirname, 'does-not-exist')
          expect(() => {
            BrowserWindow.addDevToolsExtension(nonexistentExtensionPath)
          }).to.throw(/ENOENT: no such file or directory/)
        })

        it('throws errors for invalid manifest.json files', () => {
          const badManifestExtensionPath = path.join(__dirname, 'fixtures', 'devtools-extensions', 'bad-manifest')
          expect(() => {
            BrowserWindow.addDevToolsExtension(badManifestExtensionPath)
          }).to.throw(/Unexpected token }/)
        })
      })

      describe('for a valid extension', () => {
        const extensionName = 'foo'

        const removeExtension = () => {
          BrowserWindow.removeDevToolsExtension('foo')
          expect(BrowserWindow.getDevToolsExtensions().hasOwnProperty(extensionName)).to.equal(false)
        }

        const addExtension = () => {
          const extensionPath = path.join(__dirname, 'fixtures', 'devtools-extensions', 'foo')
          BrowserWindow.addDevToolsExtension(extensionPath)
          expect(BrowserWindow.getDevToolsExtensions().hasOwnProperty(extensionName)).to.equal(true)

          showLastDevToolsPanel()

          w.loadURL('about:blank')
        }

        // After* hooks won't be called if a test fail.
        // So let's make a clean-up in the before hook.
        beforeEach(removeExtension)

        describe('when the devtools is docked', () => {
          beforeEach(function (done) {
            addExtension()
            w.webContents.openDevTools({mode: 'bottom'})
            ipcMain.once('answer', (event, message) => {
              this.message = message
              done()
            })
          })

          describe('created extension info', function () {
            it('has proper "runtimeId"', function () {
              expect(this.message).to.have.own.property('runtimeId')
              expect(this.message.runtimeId).to.equal(extensionName)
            })
            it('has "tabId" matching webContents id', function () {
              expect(this.message).to.have.own.property('tabId')
              expect(this.message.tabId).to.equal(w.webContents.id)
            })
            it('has "i18nString" with proper contents', function () {
              expect(this.message).to.have.own.property('i18nString')
              expect(this.message.i18nString).to.equal('foo - bar (baz)')
            })
            it('has "storageItems" with proper contents', function () {
              expect(this.message).to.have.own.property('storageItems')
              expect(this.message.storageItems).to.deep.equal({
                local: {
                  set: {hello: 'world', world: 'hello'},
                  remove: {world: 'hello'},
                  clear: {}
                },
                sync: {
                  set: {foo: 'bar', bar: 'foo'},
                  remove: {foo: 'bar'},
                  clear: {}
                }
              })
            })
          })
        })

        describe('when the devtools is undocked', () => {
          beforeEach(function (done) {
            addExtension()
            w.webContents.openDevTools({mode: 'undocked'})
            ipcMain.once('answer', (event, message, extensionId) => {
              this.message = message
              done()
            })
          })

          describe('created extension info', function () {
            it('has proper "runtimeId"', function () {
              expect(this.message).to.have.own.property('runtimeId')
              expect(this.message.runtimeId).to.equal(extensionName)
            })
            it('has "tabId" matching webContents id', function () {
              expect(this.message).to.have.own.property('tabId')
              expect(this.message.tabId).to.equal(w.webContents.id)
            })
          })
        })
      })
    })

    it('works when used with partitions', done => {
      if (w != null) w.destroy()
      w = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: 'temp'
        }
      })

      const extensionPath = path.join(__dirname, 'fixtures', 'devtools-extensions', 'foo')
      BrowserWindow.removeDevToolsExtension('foo')
      BrowserWindow.addDevToolsExtension(extensionPath)

      showLastDevToolsPanel()

      w.loadURL('about:blank')
      w.webContents.openDevTools({mode: 'bottom'})

      ipcMain.once('answer', (event, message) => {
        expect(message.runtimeId).to.equal('foo')
        done()
      })
    })

    it('serializes the registered extensions on quit', () => {
      const extensionName = 'foo'
      const extensionPath = path.join(__dirname, 'fixtures', 'devtools-extensions', extensionName)
      const serializedPath = path.join(app.getPath('userData'), 'DevTools Extensions')

      BrowserWindow.addDevToolsExtension(extensionPath)
      app.emit('will-quit')
      expect(JSON.parse(fs.readFileSync(serializedPath))).to.deep.equal([extensionPath])

      BrowserWindow.removeDevToolsExtension(extensionName)
      app.emit('will-quit')
      expect(fs.existsSync(serializedPath)).to.be.false()
    })

    describe('BrowserWindow.addExtension', () => {
      beforeEach(() => {
        BrowserWindow.removeExtension('foo')
        expect(BrowserWindow.getExtensions().hasOwnProperty('foo')).to.be.false()

        const extensionPath = path.join(__dirname, 'fixtures', 'devtools-extensions', 'foo')
        BrowserWindow.addExtension(extensionPath)
        expect(BrowserWindow.getExtensions().hasOwnProperty('foo')).to.be.true()

        showLastDevToolsPanel()

        w.loadURL('about:blank')
      })

      it('throws errors for missing manifest.json files', () => {
        expect(() => {
          BrowserWindow.addExtension(path.join(__dirname, 'does-not-exist'))
        }).to.throw(/ENOENT: no such file or directory/)
      })

      it('throws errors for invalid manifest.json files', () => {
        expect(() => {
          BrowserWindow.addExtension(path.join(__dirname, 'fixtures', 'devtools-extensions', 'bad-manifest'))
        }).to.throw(/Unexpected token }/)
      })
    })
  })

  describe('window.webContents.executeJavaScript', () => {
    const expected = 'hello, world!'
    const expectedErrorMsg = 'woops!'
    const code = `(() => "${expected}")()`
    const asyncCode = `(() => new Promise(r => setTimeout(() => r("${expected}"), 500)))()`
    const badAsyncCode = `(() => new Promise((r, e) => setTimeout(() => e("${expectedErrorMsg}"), 500)))()`
    const errorTypes = new Set([
      Error,
      ReferenceError,
      EvalError,
      RangeError,
      SyntaxError,
      TypeError,
      URIError
    ])

    it('doesnt throw when no calback is provided', () => {
      const result = ipcRenderer.sendSync('executeJavaScript', code, false)
      expect(result).to.equal('success')
    })

    it('returns result when calback is provided', done => {
      ipcRenderer.send('executeJavaScript', code, true)
      ipcRenderer.once('executeJavaScript-response', (event, result) => {
        expect(result).to.equal(expected)
        done()
      })
    })

    it('returns result if the code returns an asyncronous promise', done => {
      ipcRenderer.send('executeJavaScript', asyncCode, true)
      ipcRenderer.once('executeJavaScript-response', (event, result) => {
        expect(result).to.equal(expected)
        done()
      })
    })

    it('resolves the returned promise with the result when a callback is specified', done => {
      ipcRenderer.send('executeJavaScript', code, true)
      ipcRenderer.once('executeJavaScript-promise-response', (event, result) => {
        expect(result).to.equal(expected)
        done()
      })
    })

    it('resolves the returned promise with the result when no callback is specified', done => {
      ipcRenderer.send('executeJavaScript', code, false)
      ipcRenderer.once('executeJavaScript-promise-response', (event, result) => {
        expect(result).to.equal(expected)
        done()
      })
    })

    it('resolves the returned promise with the result if the code returns an asyncronous promise', done => {
      ipcRenderer.send('executeJavaScript', asyncCode, true)
      ipcRenderer.once('executeJavaScript-promise-response', (event, result) => {
        expect(result).to.equal(expected)
        done()
      })
    })

    it('rejects the returned promise if an async error is thrown', done => {
      ipcRenderer.send('executeJavaScript', badAsyncCode, true)
      ipcRenderer.once('executeJavaScript-promise-error', (event, error) => {
        expect(error).to.equal(expectedErrorMsg)
        done()
      })
    })

    it('rejects the returned promise with an error if an Error.prototype is thrown', async () => {
      for (const error in errorTypes) {
        await new Promise((resolve) => {
          ipcRenderer.send('executeJavaScript', `Promise.reject(new ${error.name}("Wamp-wamp")`, true)
          ipcRenderer.once('executeJavaScript-promise-error-name', (event, name) => {
            expect(name).to.equal(error.name)
            resolve()
          })
        })
      }
    })

    it('works after page load and during subframe load', done => {
      w.webContents.once('did-finish-load', () => {
        // initiate a sub-frame load, then try and execute script during it
        w.webContents.executeJavaScript(`
          var iframe = document.createElement('iframe')
          iframe.src = '${server.url}/slow'
          document.body.appendChild(iframe)
        `, () => {
          w.webContents.executeJavaScript('console.log(\'hello\')', () => {
            done()
          })
        })
      })
      w.loadURL(server.url)
    })

    it('executes after page load', done => {
      w.webContents.executeJavaScript(code, result => {
        expect(result).to.equal(expected)
        done()
      })
      w.loadURL(server.url)
    })

    it('works with result objects that have DOM class prototypes', done => {
      w.webContents.executeJavaScript('document.location', result => {
        expect(result.origin).to.equal(server.url)
        expect(result.protocol).to.equal('http:')
        done()
      })
      w.loadURL(server.url)
    })
  })

  describe('previewFile', () => {
    before(function () {
      if (process.platform !== 'darwin') {
        this.skip()
      }
    })

    it('opens the path in Quick Look on macOS', () => {
      expect(() => {
        w.previewFile(__filename)
        w.closeFilePreview()
      }).to.not.throw()
    })
  })

  describe('contextIsolation option with and without sandbox option', () => {
    const expectedContextData = {
      preloadContext: {
        preloadProperty: 'number',
        pageProperty: 'undefined',
        typeofRequire: 'function',
        typeofProcess: 'object',
        typeofArrayPush: 'function',
        typeofFunctionApply: 'function'
      },
      pageContext: {
        preloadProperty: 'undefined',
        pageProperty: 'string',
        typeofRequire: 'undefined',
        typeofProcess: 'undefined',
        typeofArrayPush: 'number',
        typeofFunctionApply: 'boolean',
        typeofPreloadExecuteJavaScriptProperty: 'number',
        typeofOpenedWindow: 'object'
      }
    }

    beforeEach(() => {
      if (w != null) w.destroy()
      w = new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: true,
          preload: path.join(fixtures, 'api', 'isolated-preload.js')
        }
      })
      if (ws != null) ws.destroy()
      ws = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          preload: path.join(fixtures, 'api', 'isolated-preload.js')
        }
      })
    })

    afterEach(() => {
      if (ws != null) ws.destroy()
    })

    it('separates the page context from the Electron/preload context', done => {
      ipcMain.once('isolated-world', (event, data) => {
        expect(data).to.deep.equal(expectedContextData)
        done()
      })
      w.loadURL(`file://${fixtures}/api/isolated.html`)
    })

    it('recreates the contexts on reload', done => {
      w.webContents.once('did-finish-load', () => {
        ipcMain.once('isolated-world', (event, data) => {
          expect(data).to.deep.equal(expectedContextData)
          done()
        })
        w.webContents.reload()
      })
      w.loadURL(`file://${fixtures}/api/isolated.html`)
    })

    it('enables context isolation on child windows', done => {
      app.once('browser-window-created', (event, window) => {
        expect(window.webContents.getLastWebPreferences().contextIsolation).to.be.true()
        done()
      })
      w.loadURL(`file://${fixtures}/pages/window-open.html`)
    })

    it('separates the page context from the Electron/preload context with sandbox on', done => {
      ipcMain.once('isolated-sandbox-world', (event, data) => {
        expect(data).to.deep.equal(expectedContextData)
        done()
      })
      w.loadURL(`file://${fixtures}/api/isolated.html`)
    })

    it('recreates the contexts on reload with sandbox on', done => {
      w.webContents.once('did-finish-load', () => {
        ipcMain.once('isolated-sandbox-world', (event, data) => {
          expect(data).to.deep.equal(expectedContextData)
          done()
        })
        w.webContents.reload()
      })
      w.loadURL(`file://${fixtures}/api/isolated.html`)
    })
  })

  describe('offscreen rendering', () => {
    beforeEach(function () {
      if (!features.isOffscreenRenderingEnabled()) {
        // XXX(alexeykuzmin): "afterEach" hook is not called
        // for skipped tests, we have to close the window manually.
        return closeTheWindow().then(() => { this.skip() })
      }

      if (w != null) w.destroy()
      w = new BrowserWindow({
        width: 100,
        height: 100,
        show: false,
        webPreferences: {
          backgroundThrottling: false,
          offscreen: true
        }
      })
    })

    it('creates offscreen window with correct size', done => {
      w.webContents.once('paint', (event, rect, data) => {
        expect(data.length).to.not.equal(0)
        let size = data.getSize()
        assertWithinDelta(size.width, 100, 2, 'width')
        assertWithinDelta(size.height, 100, 2, 'height')
        done()
      })
      w.loadURL(`file://${fixtures}/api/offscreen-rendering.html`)
    })

    describe('window.webContents.isOffscreen()', () => {
      it('is true for offscreen type', () => {
        w.loadURL(`file://${fixtures}/api/offscreen-rendering.html`)
        expect(w.webContents.isOffscreen()).to.be.true()
      })

      it('is false for regular window', () => {
        let c = new BrowserWindow({show: false})
        expect(c.webContents.isOffscreen()).to.be.false()
        c.destroy()
      })
    })

    describe('window.webContents.isPainting()', () => {
      it('returns whether is currently painting', done => {
        w.webContents.once('paint', (event, rect, data) => {
          expect(w.webContents.isPainting()).to.be.true()
          done()
        })
        w.loadURL(`file://{$fixtures}/api/offscreen-rendering.html`)
      })
    })

    describe('window.webContents.stopPainting()', () => {
      it('stops painting', done => {
        w.webContents.on('dom-ready', () => {
          w.webContents.stopPainting()
          expect(w.webContents.isPainting()).to.be.false()
          done()
        })
        w.loadURL(`file://${fixtures}/api/offscreen-rendering.html`)
      })
    })

    describe('window.webContents.startPainting()', () => {
      it('starts painting', done => {
        w.webContents.on('dom-ready', () => {
          w.webContents.stopPainting()
          w.webContents.startPainting()
          w.webContents.once('paint', (event, rect, data) => {
            expect(w.webContents.isPainting()).to.be.true()
            done()
          })
        })
        w.loadURL(`file://${fixtures}/api/offscreen-rendering.html`)
      })
    })

    describe('window.webContents.getFrameRate()', () => {
      it('has default frame rate', done => {
        w.webContents.once('paint', (event, rect, data) => {
          expect(w.webContents.getFrameRate()).to.equal(60)
          done()
        })
        w.loadURL(`file://${fixtures}/api/offscreen-rendering.html`)
      })
    })

    describe('window.webContents.setFrameRate(frameRate)', () => {
      it('sets custom frame rate', done => {
        w.webContents.on('dom-ready', () => {
          w.webContents.setFrameRate(30)
          w.webContents.once('paint', (event, rect, data) => {
            expect(w.webContents.getFrameRate()).to.equal(30)
            done()
          })
        })
        w.loadURL(`file://${fixtures}/api/offscreen-rendering.html`)
      })
    })
  })
})

const assertBoundsEqual = (actual, expect) => {
  if (!isScaleFactorRounding()) {
    expect(expect).to.deep.equal(actual)
  } else if (Array.isArray(actual)) {
    assertWithinDelta(actual[0], expect[0], 1, 'x')
    assertWithinDelta(actual[1], expect[1], 1, 'y')
  } else {
    assertWithinDelta(actual.x, expect.x, 1, 'x')
    assertWithinDelta(actual.y, expect.y, 1, 'y')
    assertWithinDelta(actual.width, expect.width, 1, 'width')
    assertWithinDelta(actual.height, expect.height, 1, 'height')
  }
}

const assertWithinDelta = (actual, expect, delta, label) => {
  const result = Math.abs(actual - expect)
  expect(result <= delta).to.be.true(`${label} value of ${actual} was not within ${delta} of ${expect}`)
}

// Is the display's scale factor possibly causing rounding of pixel coordinate
// values?
const isScaleFactorRounding = () => {
  const {scaleFactor} = screen.getPrimaryDisplay()
  // Return true if scale factor is non-integer value
  if (Math.round(scaleFactor) !== scaleFactor) return true
  // Return true if scale factor is odd number above 2
  return scaleFactor > 2 && scaleFactor % 2 === 1
}

function serveFileFromProtocol (protocolName, filePath) {
  return new Promise((resolve, reject) => {
    protocol.registerBufferProtocol(protocolName, (request, callback) => {
      // Disabled due to false positive in StandardJS
      // eslint-disable-next-line standard/no-callback-literal
      callback({
        mimeType: 'text/html',
        data: fs.readFileSync(filePath)
      })
    }, (error) => {
      if (error != null) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}
