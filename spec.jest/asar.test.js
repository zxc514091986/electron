const ChildProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const util = require('util')
const { closeWindow } = require('./helpers/window-helpers')

const nativeImage = require('electron').nativeImage
const remote = require('electron').remote

const ipcMain = remote.require('electron').ipcMain
const BrowserWindow = remote.require('electron').BrowserWindow

describe('asar package', function () {
  const fixtures = path.join(__dirname, '../spec', 'fixtures')

  describe('node api', function () {
    it('supports paths specified as a Buffer', function () {
      var file = Buffer.from(path.join(fixtures, 'asar', 'a.asar', 'file1'))
      expect(fs.existsSync(file)).toStrictEqual(true)
    })

    describe('fs.readFileSync', function () {
      it('does not leak fd', function () {
        var readCalls = 1
        while (readCalls <= 10000) {
          fs.readFileSync(path.join(process.resourcesPath, 'electron.asar', 'renderer', 'api', 'ipc-renderer.js'))
          readCalls++
        }
      })

      it('reads a normal file', function () {
        var file1 = path.join(fixtures, 'asar', 'a.asar', 'file1')
        expect(fs.readFileSync(file1).toString().trim()).toStrictEqual('file1')
        var file2 = path.join(fixtures, 'asar', 'a.asar', 'file2')
        expect(fs.readFileSync(file2).toString().trim()).toStrictEqual('file2')
        var file3 = path.join(fixtures, 'asar', 'a.asar', 'file3')
        expect(fs.readFileSync(file3).toString().trim()).toStrictEqual('file3')
      })

      it('reads from a empty file', function () {
        var file = path.join(fixtures, 'asar', 'empty.asar', 'file1')
        var buffer = fs.readFileSync(file)
        expect(buffer.length).toStrictEqual(0)
        expect(buffer.toString()).toStrictEqual('')
      })

      it('reads a linked file', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link1')
        expect(fs.readFileSync(p).toString().trim()).toStrictEqual('file1')
      })

      it('reads a file from linked directory', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'file1')
        expect(fs.readFileSync(p).toString().trim()).toStrictEqual('file1')
        p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'link2', 'file1')
        expect(fs.readFileSync(p).toString().trim()).toStrictEqual('file1')
      })

      it('throws ENOENT error when can not find file', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        var throws = function () {
          fs.readFileSync(p)
        }
        expect(throws).toThrow(/ENOENT/)
      })

      it('passes ENOENT error to callback when can not find file', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        var async = false
        fs.readFile(p, function (e) {
          expect(async).toBeTruthy()
          expect(/ENOENT/.test(e)).toBeTruthy()
        })
        async = true
      })

      it('reads a normal file with unpacked files', function () {
        var p = path.join(fixtures, 'asar', 'unpack.asar', 'a.txt')
        expect(fs.readFileSync(p).toString().trim()).toStrictEqual('a')
      })
    })

    describe('fs.readFile', function () {
      it('reads a normal file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file1')
        fs.readFile(p, function (err, content) {
          expect(err).toStrictEqual(null)
          expect(String(content).trim()).toStrictEqual('file1')
          done()
        })
      })

      it('reads from a empty file', function (done) {
        var p = path.join(fixtures, 'asar', 'empty.asar', 'file1')
        fs.readFile(p, function (err, content) {
          expect(err).toStrictEqual(null)
          expect(String(content)).toStrictEqual('')
          done()
        })
      })

      it('reads from a empty file with encoding', function (done) {
        var p = path.join(fixtures, 'asar', 'empty.asar', 'file1')
        fs.readFile(p, 'utf8', function (err, content) {
          expect(err).toStrictEqual(null)
          expect(content).toStrictEqual('')
          done()
        })
      })

      it('reads a linked file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link1')
        fs.readFile(p, function (err, content) {
          expect(err).toStrictEqual(null)
          expect(String(content).trim()).toStrictEqual('file1')
          done()
        })
      })

      it('reads a file from linked directory', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'link2', 'file1')
        fs.readFile(p, function (err, content) {
          expect(err).toStrictEqual(null)
          expect(String(content).trim()).toStrictEqual('file1')
          done()
        })
      })

      it('throws ENOENT error when can not find file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        fs.readFile(p, function (err) {
          expect(err.code).toStrictEqual('ENOENT')
          done()
        })
      })
    })

    describe('fs.lstatSync', function () {
      it('handles path with trailing slash correctly', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'link2', 'file1')
        fs.lstatSync(p)
        fs.lstatSync(p + '/')
      })

      it('returns information of root', function () {
        var p = path.join(fixtures, 'asar', 'a.asar')
        var stats = fs.lstatSync(p)
        expect(stats.isFile()).toStrictEqual(false)
        expect(stats.isDirectory()).toStrictEqual(true)
        expect(stats.isSymbolicLink()).toStrictEqual(false)
        expect(stats.size).toStrictEqual(0)
      })

      it('returns information of a normal file', function () {
        var file, j, len, p, ref2, stats
        ref2 = ['file1', 'file2', 'file3', path.join('dir1', 'file1'), path.join('link2', 'file1')]
        for (j = 0, len = ref2.length; j < len; j++) {
          file = ref2[j]
          p = path.join(fixtures, 'asar', 'a.asar', file)
          stats = fs.lstatSync(p)
          expect(stats.isFile()).toStrictEqual(true)
          expect(stats.isDirectory()).toStrictEqual(false)
          expect(stats.isSymbolicLink()).toStrictEqual(false)
          expect(stats.size).toStrictEqual(6)
        }
      })

      it('returns information of a normal directory', function () {
        var file, j, len, p, ref2, stats
        ref2 = ['dir1', 'dir2', 'dir3']
        for (j = 0, len = ref2.length; j < len; j++) {
          file = ref2[j]
          p = path.join(fixtures, 'asar', 'a.asar', file)
          stats = fs.lstatSync(p)
          expect(stats.isFile()).toStrictEqual(false)
          expect(stats.isDirectory()).toStrictEqual(true)
          expect(stats.isSymbolicLink()).toStrictEqual(false)
          expect(stats.size).toStrictEqual(0)
        }
      })

      it('returns information of a linked file', function () {
        var file, j, len, p, ref2, stats
        ref2 = ['link1', path.join('dir1', 'link1'), path.join('link2', 'link2')]
        for (j = 0, len = ref2.length; j < len; j++) {
          file = ref2[j]
          p = path.join(fixtures, 'asar', 'a.asar', file)
          stats = fs.lstatSync(p)
          expect(stats.isFile()).toStrictEqual(false)
          expect(stats.isDirectory()).toStrictEqual(false)
          expect(stats.isSymbolicLink()).toStrictEqual(true)
          expect(stats.size).toStrictEqual(0)
        }
      })

      it('returns information of a linked directory', function () {
        var file, j, len, p, ref2, stats
        ref2 = ['link2', path.join('dir1', 'link2'), path.join('link2', 'link2')]
        for (j = 0, len = ref2.length; j < len; j++) {
          file = ref2[j]
          p = path.join(fixtures, 'asar', 'a.asar', file)
          stats = fs.lstatSync(p)
          expect(stats.isFile()).toStrictEqual(false)
          expect(stats.isDirectory()).toStrictEqual(false)
          expect(stats.isSymbolicLink()).toStrictEqual(true)
          expect(stats.size).toStrictEqual(0)
        }
      })

      it('throws ENOENT error when can not find file', function () {
        var file, j, len, p, ref2, throws
        ref2 = ['file4', 'file5', path.join('dir1', 'file4')]
        for (j = 0, len = ref2.length; j < len; j++) {
          file = ref2[j]
          p = path.join(fixtures, 'asar', 'a.asar', file)
          throws = function () {
            fs.lstatSync(p)
          }
          expect(throws).toThrow(/ENOENT/)
        }
      })
    })

    describe('fs.lstat', function () {
      it('handles path with trailing slash correctly', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'link2', 'file1')
        fs.lstat(p + '/', done)
      })

      it('returns information of root', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar')
        fs.lstat(p, function (err, stats) {
          expect(err).toStrictEqual(null)
          expect(stats.isFile()).toStrictEqual(false)
          expect(stats.isDirectory()).toStrictEqual(true)
          expect(stats.isSymbolicLink()).toStrictEqual(false)
          expect(stats.size).toStrictEqual(0)
          done()
        })
      })

      it('returns information of a normal file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'file1')
        fs.lstat(p, function (err, stats) {
          expect(err).toStrictEqual(null)
          expect(stats.isFile()).toStrictEqual(true)
          expect(stats.isDirectory()).toStrictEqual(false)
          expect(stats.isSymbolicLink()).toStrictEqual(false)
          expect(stats.size).toStrictEqual(6)
          done()
        })
      })

      it('returns information of a normal directory', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'dir1')
        fs.lstat(p, function (err, stats) {
          expect(err).toStrictEqual(null)
          expect(stats.isFile()).toStrictEqual(false)
          expect(stats.isDirectory()).toStrictEqual(true)
          expect(stats.isSymbolicLink()).toStrictEqual(false)
          expect(stats.size).toStrictEqual(0)
          done()
        })
      })

      it('returns information of a linked file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'link1')
        fs.lstat(p, function (err, stats) {
          expect(err).toStrictEqual(null)
          expect(stats.isFile()).toStrictEqual(false)
          expect(stats.isDirectory()).toStrictEqual(false)
          expect(stats.isSymbolicLink()).toStrictEqual(true)
          expect(stats.size).toStrictEqual(0)
          done()
        })
      })

      it('returns information of a linked directory', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'link2')
        fs.lstat(p, function (err, stats) {
          expect(err).toStrictEqual(null)
          expect(stats.isFile()).toStrictEqual(false)
          expect(stats.isDirectory()).toStrictEqual(false)
          expect(stats.isSymbolicLink()).toStrictEqual(true)
          expect(stats.size).toStrictEqual(0)
          done()
        })
      })

      it('throws ENOENT error when can not find file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file4')
        fs.lstat(p, function (err) {
          expect(err.code).toStrictEqual('ENOENT')
          done()
        })
      })
    })

    describe('fs.realpathSync', () => {
      it('returns real path root', () => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = 'a.asar'
        const r = fs.realpathSync(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, p))
      })

      it('returns real path of a normal file', () => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'file1')
        const r = fs.realpathSync(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, p))
      })

      it('returns real path of a normal directory', () => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'dir1')
        const r = fs.realpathSync(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, p))
      })

      it('returns real path of a linked file', () => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'link2', 'link1')
        const r = fs.realpathSync(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, 'a.asar', 'file1'))
      })

      it('returns real path of a linked directory', () => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'link2', 'link2')
        const r = fs.realpathSync(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, 'a.asar', 'dir1'))
      })

      it('returns real path of an unpacked file', () => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('unpack.asar', 'a.txt')
        const r = fs.realpathSync(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, p))
      })

      it('throws ENOENT error when can not find file', () => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'not-exist')
        const throws = () => fs.realpathSync(path.join(parent, p))
        expect(throws).toThrow(/ENOENT/)
      })
    })

    describe('fs.realpathSync.native', () => {
      it('returns real path root', () => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = 'a.asar'
        const r = fs.realpathSync.native(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, p))
      })

      it('returns real path of a normal file', () => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'file1')
        const r = fs.realpathSync.native(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, p))
      })

      it('returns real path of a normal directory', () => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'dir1')
        const r = fs.realpathSync.native(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, p))
      })

      it('returns real path of a linked file', () => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'link2', 'link1')
        const r = fs.realpathSync.native(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, 'a.asar', 'file1'))
      })

      it('returns real path of a linked directory', () => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'link2', 'link2')
        const r = fs.realpathSync.native(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, 'a.asar', 'dir1'))
      })

      it('returns real path of an unpacked file', () => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('unpack.asar', 'a.txt')
        const r = fs.realpathSync.native(path.join(parent, p))
        expect(r).toStrictEqual(path.join(parent, p))
      })

      it('throws ENOENT error when can not find file', () => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'not-exist')
        const throws = () => fs.realpathSync.native(path.join(parent, p))
        expect(throws).toThrow(/ENOENT/)
      })
    })

    describe('fs.realpath', () => {
      it('returns real path root', done => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = 'a.asar'
        fs.realpath(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, p))
          done()
        })
      })

      it('returns real path of a normal file', done => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'file1')
        fs.realpath(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, p))
          done()
        })
      })

      it('returns real path of a normal directory', done => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'dir1')
        fs.realpath(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, p))
          done()
        })
      })

      it('returns real path of a linked file', done => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'link2', 'link1')
        fs.realpath(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, 'a.asar', 'file1'))
          done()
        })
      })

      it('returns real path of a linked directory', done => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'link2', 'link2')
        fs.realpath(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, 'a.asar', 'dir1'))
          done()
        })
      })

      it('returns real path of an unpacked file', done => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('unpack.asar', 'a.txt')
        fs.realpath(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, p))
          done()
        })
      })

      it('throws ENOENT error when can not find file', done => {
        const parent = fs.realpathSync(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'not-exist')
        fs.realpath(path.join(parent, p), err => {
          expect(err.code).toStrictEqual('ENOENT')
          done()
        })
      })
    })

    describe('fs.realpath.native', () => {
      it('returns real path root', done => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = 'a.asar'
        fs.realpath.native(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, p))
          done()
        })
      })

      it('returns real path of a normal file', done => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'file1')
        fs.realpath.native(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, p))
          done()
        })
      })

      it('returns real path of a normal directory', done => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'dir1')
        fs.realpath.native(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, p))
          done()
        })
      })

      it('returns real path of a linked file', done => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'link2', 'link1')
        fs.realpath.native(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, 'a.asar', 'file1'))
          done()
        })
      })

      it('returns real path of a linked directory', done => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'link2', 'link2')
        fs.realpath.native(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, 'a.asar', 'dir1'))
          done()
        })
      })

      it('returns real path of an unpacked file', done => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('unpack.asar', 'a.txt')
        fs.realpath.native(path.join(parent, p), (err, r) => {
          expect(err).toStrictEqual(null)
          expect(r).toStrictEqual(path.join(parent, p))
          done()
        })
      })

      it('throws ENOENT error when can not find file', done => {
        const parent = fs.realpathSync.native(path.join(fixtures, 'asar'))
        const p = path.join('a.asar', 'not-exist')
        fs.realpath.native(path.join(parent, p), err => {
          expect(err.code).toStrictEqual('ENOENT')
          done()
        })
      })
    })

    describe('fs.readdirSync', function () {
      it('reads dirs from root', function () {
        var p = path.join(fixtures, 'asar', 'a.asar')
        var dirs = fs.readdirSync(p)
        expect(dirs).toStrictEqual(['dir1', 'dir2', 'dir3', 'file1', 'file2', 'file3', 'link1', 'link2', 'ping.js'])
      })

      it('reads dirs from a normal dir', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'dir1')
        var dirs = fs.readdirSync(p)
        expect(dirs).toStrictEqual(['file1', 'file2', 'file3', 'link1', 'link2'])
      })

      it('reads dirs from a linked dir', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'link2')
        var dirs = fs.readdirSync(p)
        expect(dirs).toStrictEqual(['file1', 'file2', 'file3', 'link1', 'link2'])
      })

      it('throws ENOENT error when can not find file', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        var throws = function () {
          fs.readdirSync(p)
        }
        expect(throws).toThrow(/ENOENT/)
      })
    })

    describe('fs.readdir', function () {
      it('reads dirs from root', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar')
        fs.readdir(p, function (err, dirs) {
          expect(err).toStrictEqual(null)
          expect(dirs).toStrictEqual(['dir1', 'dir2', 'dir3', 'file1', 'file2', 'file3', 'link1', 'link2', 'ping.js'])
          done()
        })
      })

      it('reads dirs from a normal dir', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'dir1')
        fs.readdir(p, function (err, dirs) {
          expect(err).toStrictEqual(null)
          expect(dirs).toStrictEqual(['file1', 'file2', 'file3', 'link1', 'link2'])
          done()
        })
      })
      it('reads dirs from a linked dir', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'link2', 'link2')
        fs.readdir(p, function (err, dirs) {
          expect(err).toStrictEqual(null)
          expect(dirs).toStrictEqual(['file1', 'file2', 'file3', 'link1', 'link2'])
          done()
        })
      })

      it('throws ENOENT error when can not find file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        fs.readdir(p, function (err) {
          expect(err.code).toStrictEqual('ENOENT')
          done()
        })
      })
    })

    describe('fs.openSync', function () {
      it('opens a normal/linked/under-linked-directory file', function () {
        var buffer, fd, file, j, len, p, ref2
        ref2 = ['file1', 'link1', path.join('link2', 'file1')]
        for (j = 0, len = ref2.length; j < len; j++) {
          file = ref2[j]
          p = path.join(fixtures, 'asar', 'a.asar', file)
          fd = fs.openSync(p, 'r')
          buffer = Buffer.alloc(6)
          fs.readSync(fd, buffer, 0, 6, 0)
          expect(String(buffer).trim()).toStrictEqual('file1')
          fs.closeSync(fd)
        }
      })

      it('throws ENOENT error when can not find file', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        var throws = function () {
          fs.openSync(p)
        }
        expect(throws).toThrow(/ENOENT/)
      })
    })

    describe('fs.open', function () {
      it('opens a normal file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file1')
        fs.open(p, 'r', function (err, fd) {
          expect(err).toStrictEqual(null)
          var buffer = Buffer.alloc(6)
          fs.read(fd, buffer, 0, 6, 0, function (err) {
            expect(err).toStrictEqual(null)
            expect(String(buffer).trim()).toStrictEqual('file1')
            fs.close(fd, done)
          })
        })
      })

      it('throws ENOENT error when can not find file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        fs.open(p, 'r', function (err) {
          expect(err.code).toStrictEqual('ENOENT')
          done()
        })
      })
    })

    describe('fs.mkdir', function () {
      it('throws error when calling inside asar archive', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        fs.mkdir(p, function (err) {
          expect(err.code).toStrictEqual('ENOTDIR')
          done()
        })
      })
    })

    describe('fs.mkdirSync', function () {
      it('throws error when calling inside asar archive', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        expect(function () {
          fs.mkdirSync(p)
        }).toThrow(/ENOTDIR/)
      })
    })

    describe('fs.exists', function () {
      it('handles an existing file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file1')
        // eslint-disable-next-line
        fs.exists(p, function (exists) {
          expect(exists).toStrictEqual(true)
          done()
        })
      })

      it('handles a non-existent file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        // eslint-disable-next-line
        fs.exists(p, function (exists) {
          expect(exists).toStrictEqual(false)
          done()
        })
      })

      it('promisified version handles an existing file', (done) => {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file1')
        // eslint-disable-next-line
        util.promisify(fs.exists)(p).then(exists => {
          expect(exists).toStrictEqual(true)
          done()
        })
      })

      it('promisified version handles a non-existent file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        // eslint-disable-next-line
        util.promisify(fs.exists)(p).then(exists => {
          expect(exists).toStrictEqual(false)
          done()
        })
      })
    })

    describe('fs.existsSync', function () {
      it('handles an existing file', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file1')
        expect(function () {
          expect(fs.existsSync(p)).toStrictEqual(true)
        }).not.toThrow()
      })

      it('handles a non-existent file', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        expect(function () {
          expect(fs.existsSync(p)).toStrictEqual(false)
        }).not.toThrow()
      })
    })

    describe('fs.access', function () {
      it('accesses a normal file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file1')
        fs.access(p, function (err) {
          expect(err).toBeFalsy()
          done()
        })
      })

      it('throws an error when called with write mode', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file1')
        fs.access(p, fs.constants.R_OK | fs.constants.W_OK, function (err) {
          expect(err.code).toStrictEqual('EACCES')
          done()
        })
      })

      it('throws an error when called on non-existent file', function (done) {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        fs.access(p, function (err) {
          expect(err.code).toStrictEqual('ENOENT')
          done()
        })
      })

      it('allows write mode for unpacked files', function (done) {
        var p = path.join(fixtures, 'asar', 'unpack.asar', 'a.txt')
        fs.access(p, fs.constants.R_OK | fs.constants.W_OK, function (err) {
          expect(err).toBeNull()
          done()
        })
      })
    })

    describe('fs.accessSync', function () {
      it('accesses a normal file', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file1')
        expect(function () {
          fs.accessSync(p)
        }).not.toThrow()
      })

      it('throws an error when called with write mode', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'file1')
        expect(function () {
          fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK)
        }).toThrow(/EACCES/)
      })

      it('throws an error when called on non-existent file', function () {
        var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
        expect(function () {
          fs.accessSync(p)
        }).toThrow(/ENOENT/)
      })

      it('allows write mode for unpacked files', function () {
        var p = path.join(fixtures, 'asar', 'unpack.asar', 'a.txt')
        expect(function () {
          fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK)
        }).not.toThrow()
      })
    })

    describe('child_process.fork', function () {
      it('opens a normal js file', function (done) {
        var child = ChildProcess.fork(path.join(fixtures, 'asar', 'a.asar', 'ping.js'))
        child.on('message', function (msg) {
          expect(msg).toStrictEqual('message')
          done()
        })
        child.send('message')
      })

      it('supports asar in the forked js', function (done) {
        var file = path.join(fixtures, 'asar', 'a.asar', 'file1')
        var child = ChildProcess.fork(path.join(fixtures, 'module', 'asar.js'))
        child.on('message', function (content) {
          expect(content).toStrictEqual(fs.readFileSync(file).toString())
          done()
        })
        child.send(file)
      })
    })

    describe('child_process.exec', function () {
      var echo = path.join(fixtures, 'asar', 'echo.asar', 'echo')

      it('should not try to extract the command if there is a reference to a file inside an .asar', function (done) {
        ChildProcess.exec('echo ' + echo + ' foo bar', function (error, stdout) {
          expect(error).toStrictEqual(null)
          expect(stdout.toString().replace(/\r/g, '')).toStrictEqual(echo + ' foo bar\n')
          done()
        })
      })

      it('can be promisified', () => {
        return util.promisify(ChildProcess.exec)('echo ' + echo + ' foo bar').then(({ stdout }) => {
          expect(stdout.toString().replace(/\r/g, '')).toStrictEqual(echo + ' foo bar\n')
        })
      })
    })

    describe('child_process.execSync', function () {
      var echo = path.join(fixtures, 'asar', 'echo.asar', 'echo')

      it('should not try to extract the command if there is a reference to a file inside an .asar', function (done) {
        var stdout = ChildProcess.execSync('echo ' + echo + ' foo bar')
        expect(stdout.toString().replace(/\r/g, '')).toStrictEqual(echo + ' foo bar\n')
        done()
      })
    })

    describe('child_process.execFile', function () {
      var echo, execFile, execFileSync
      execFile = ChildProcess.execFile
      execFileSync = ChildProcess.execFileSync
      echo = path.join(fixtures, 'asar', 'echo.asar', 'echo')

      const test = process.platform !== 'darwin' ? xit : it

      test('executes binaries', function (done) {
        execFile(echo, ['test'], function (error, stdout) {
          expect(error).toStrictEqual(null)
          expect(stdout).toStrictEqual('test\n')
          done()
        })
      })

      test('execFileSync executes binaries', function () {
        var output = execFileSync(echo, ['test'])
        expect(String(output)).toStrictEqual('test\n')
      })

      test('can be promisified', () => {
        return util.promisify(ChildProcess.execFile)(echo, ['test']).then(({ stdout }) => {
          expect(stdout).toStrictEqual('test\n')
        })
      })
    })

    describe('internalModuleReadJSON', function () {
      var internalModuleReadJSON = process.binding('fs').internalModuleReadJSON

      it('read a normal file', function () {
        var file1 = path.join(fixtures, 'asar', 'a.asar', 'file1')
        expect(internalModuleReadJSON(file1).toString().trim()).toStrictEqual('file1')
        var file2 = path.join(fixtures, 'asar', 'a.asar', 'file2')
        expect(internalModuleReadJSON(file2).toString().trim()).toStrictEqual('file2')
        var file3 = path.join(fixtures, 'asar', 'a.asar', 'file3')
        expect(internalModuleReadJSON(file3).toString().trim()).toStrictEqual('file3')
      })

      it('reads a normal file with unpacked files', function () {
        var p = path.join(fixtures, 'asar', 'unpack.asar', 'a.txt')
        expect(internalModuleReadJSON(p).toString().trim()).toStrictEqual('a')
      })
    })

    describe('util.promisify', function () {
      it('can promisify all fs functions', function () {
        const originalFs = require('original-fs')
        const { hasOwnProperty } = Object.prototype

        for (const [propertyName, originalValue] of Object.entries(originalFs)) {
          // Some properties exist but have a value of `undefined` on some platforms.
          // E.g. `fs.lchmod`, which in only available on MacOS, see
          // https://nodejs.org/docs/latest-v10.x/api/fs.html#fs_fs_lchmod_path_mode_callback
          // Also check for `null`s, `hasOwnProperty()` can't handle them.
          if (typeof originalValue === 'undefined' || originalValue === null) continue

          if (hasOwnProperty.call(originalValue, util.promisify.custom)) {
            expect(fs).toHaveProperty(propertyName)
            expect(fs[propertyName][util.promisify.custom]).toBeTruthy()
          }
        }
      })
    })

    describe('process.noAsar', function () {
      var errorName = process.platform === 'win32' ? 'ENOENT' : 'ENOTDIR'

      beforeEach(function () {
        process.noAsar = true
      })

      afterEach(function () {
        process.noAsar = false
      })

      it('disables asar support in sync API', function () {
        var file = path.join(fixtures, 'asar', 'a.asar', 'file1')
        var dir = path.join(fixtures, 'asar', 'a.asar', 'dir1')
        expect(function () {
          fs.readFileSync(file)
        }).toThrow(new RegExp(errorName))
        expect(function () {
          fs.lstatSync(file)
        }).toThrow(new RegExp(errorName))
        expect(function () {
          fs.realpathSync(file)
        }).toThrow(new RegExp(errorName))
        expect(function () {
          fs.readdirSync(dir)
        }).toThrow(new RegExp(errorName))
      })

      it('disables asar support in async API', function (done) {
        var file = path.join(fixtures, 'asar', 'a.asar', 'file1')
        var dir = path.join(fixtures, 'asar', 'a.asar', 'dir1')
        fs.readFile(file, function (error) {
          expect(error.code).toStrictEqual(errorName)
          fs.lstat(file, function (error) {
            expect(error.code).toStrictEqual(errorName)
            fs.realpath(file, function (error) {
              expect(error.code).toStrictEqual(errorName)
              fs.readdir(dir, function (error) {
                expect(error.code).toStrictEqual(errorName)
                done()
              })
            })
          })
        })
      })

      it('treats *.asar as normal file', function () {
        var originalFs = require('original-fs')
        var asar = path.join(fixtures, 'asar', 'a.asar')
        var content1 = fs.readFileSync(asar)
        var content2 = originalFs.readFileSync(asar)
        expect(content1.compare(content2)).toStrictEqual(0)
        expect(function () {
          fs.readdirSync(asar)
        }).toThrow(/ENOTDIR/)
      })

      it('is reset to its original value when execSync throws an error', function () {
        process.noAsar = false
        expect(function () {
          ChildProcess.execSync(path.join(__dirname, 'does-not-exist.txt'))
        }).toThrow()
        expect(process.noAsar).toStrictEqual(false)
      })
    })

    describe('process.env.ELECTRON_NO_ASAR', function () {
      it('disables asar support in forked processes', function (done) {
        const forked = ChildProcess.fork(path.join(fixtures, 'module', 'no-asar.js'), [], {
          env: {
            ELECTRON_NO_ASAR: true
          }
        })
        forked.on('message', function (stats) {
          expect(stats.isFile).toStrictEqual(true)
          expect(stats.size).toStrictEqual(778)
          done()
        })
      })

      it('disables asar support in spawned processes', function (done) {
        const spawned = ChildProcess.spawn(process.execPath, [path.join(fixtures, 'module', 'no-asar.js')], {
          env: {
            ELECTRON_NO_ASAR: true,
            ELECTRON_RUN_AS_NODE: true
          }
        })

        let output = ''
        spawned.stdout.on('data', function (data) {
          output += data
        })
        spawned.stdout.on('close', function () {
          const stats = JSON.parse(output)
          expect(stats.isFile).toStrictEqual(true)
          expect(stats.size).toStrictEqual(778)
          done()
        })
      })
    })
  })

  describe('asar protocol', function () {
    var w = null

    afterEach(function () {
      return closeWindow(w).then(function () { w = null })
    })

    it('can request a file in package', async function () {
      var p = path.resolve(fixtures, 'asar', 'a.asar', 'file1')
      const data = await (await fetch('file://' + p)).text()
      expect(data.trim()).toEqual('file1')
    })

    it('can request a file in package with unpacked files', async function () {
      var p = path.resolve(fixtures, 'asar', 'unpack.asar', 'a.txt')
      const data = await (await fetch('file://' + p)).text()
      expect(data.trim()).toEqual('a')
    })

    it('can request a linked file in package', async function () {
      var p = path.resolve(fixtures, 'asar', 'a.asar', 'link2', 'link1')
      const data = await (await fetch('file://' + p)).text()
      expect(data.trim()).toEqual('file1')
    })

    it('can request a file in filesystem', async function () {
      var p = path.resolve(fixtures, 'asar', 'file')
      const data = await (await fetch('file://' + p)).text()
      expect(data.trim()).toEqual('file')
    })

    it('gets 404 when file is not found', function (done) {
      var p = path.resolve(fixtures, 'asar', 'a.asar', 'no-exist')
      eval(fs.readFileSync(path.resolve(__dirname, '../spec/static/jquery-2.0.3.min.js'), 'utf8'))
      $.ajax({
        url: 'file://' + p,
        error: function (err) {
          expect(err.status).toEqual(404)
          done()
        }
      })
    })

    it('sets __dirname correctly', function (done) {
      w = new BrowserWindow({
        show: false,
        width: 400,
        height: 400
      })
      var p = path.resolve(fixtures, 'asar', 'web.asar', 'index.html')
      ipcMain.once('dirname', function (event, dirname) {
        expect(dirname).toStrictEqual(path.dirname(p))
        done()
      })
      w.loadFile(p)
    })

    it('loads script tag in html', function (done) {
      w = new BrowserWindow({
        show: false,
        width: 400,
        height: 400
      })
      var p = path.resolve(fixtures, 'asar', 'script.asar', 'index.html')
      w.loadFile(p)
      ipcMain.once('ping', function (event, message) {
        expect(message).toStrictEqual('pong')
        done()
      })
    })

    it('loads video tag in html', function (done) {
      w = new BrowserWindow({
        show: false,
        width: 400,
        height: 400
      })
      var p = path.resolve(fixtures, 'asar', 'video.asar', 'index.html')
      w.loadFile(p)
      ipcMain.once('asar-video', function (event, message, error) {
        if (message === 'ended') {
          expect(error).toBeNull()
          done()
        } else if (message === 'error') {
          done(error)
        }
      })
    }, 60000)
  })

  describe('original-fs module', function () {
    var originalFs = require('original-fs')

    it('treats .asar as file', function () {
      var file = path.join(fixtures, 'asar', 'a.asar')
      var stats = originalFs.statSync(file)
      expect(stats.isFile()).toBeTruthy()
    })

    it('is available in forked scripts', function (done) {
      var child = ChildProcess.fork(path.join(fixtures, 'module', 'original-fs.js'))
      child.on('message', function (msg) {
        expect(msg).toStrictEqual('object')
        done()
      })
      child.send('message')
    })
  })

  describe('graceful-fs module', function () {
    var gfs = require('graceful-fs')

    it('recognize asar archvies', function () {
      var p = path.join(fixtures, 'asar', 'a.asar', 'link1')
      expect(gfs.readFileSync(p).toString().trim()).toStrictEqual('file1')
    })
    it('does not touch global fs object', function () {
      expect(fs.readdir).not.toStrictEqual(gfs.readdir)
    })
  })

  describe('mkdirp module', function () {
    var mkdirp = require('mkdirp')

    it('throws error when calling inside asar archive', function () {
      var p = path.join(fixtures, 'asar', 'a.asar', 'not-exist')
      expect(function () {
        mkdirp.sync(p)
      }).toThrow(/ENOTDIR/)
    })
  })

  describe('native-image', function () {
    it('reads image from asar archive', function () {
      var p = path.join(fixtures, 'asar', 'logo.asar', 'logo.png')
      var logo = nativeImage.createFromPath(p)
      expect(logo.getSize()).toStrictEqual({
        width: 55,
        height: 55
      })
    })

    it('reads image from asar archive with unpacked files', function () {
      var p = path.join(fixtures, 'asar', 'unpack.asar', 'atom.png')
      var logo = nativeImage.createFromPath(p)
      expect(logo.getSize()).toStrictEqual({
        width: 1024,
        height: 1024
      })
    })
  })
})
