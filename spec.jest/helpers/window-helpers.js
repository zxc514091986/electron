const { BrowserWindow } = require('electron').remote

const { emittedOnce } = require('./events-helpers')

exports.closeWindow = async (window = null,
  { assertSingleWindow } = { assertSingleWindow: true }) => {
  const windowExists = (window !== null) && !window.isDestroyed()
  if (windowExists) {
    const isClosed = emittedOnce(window, 'closed')
    window.setClosable(true)
    window.close()
    await isClosed
  }

  if (assertSingleWindow) {
    expect(BrowserWindow.getAllWindows().filter(
      w => w.webContents.getURL().endsWith('@jest-runner/electron/build/index.html')
    )).toHaveLength(1)
  }
}
