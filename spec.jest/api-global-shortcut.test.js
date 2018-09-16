const { globalShortcut } = require('electron').remote

describe.only('globalShortcut module', () => {
  beforeEach(() => {
    globalShortcut.unregisterAll()
  })

  it('can register and unregister accelerators', () => {
    const accelerator = 'CommandOrControl+A+B+C'

    expect(globalShortcut.isRegistered(accelerator)).toBe(false)
    globalShortcut.register(accelerator, () => {})
    expect(globalShortcut.isRegistered(accelerator)).toBe(true)
    globalShortcut.unregister(accelerator)
    expect(globalShortcut.isRegistered(accelerator)).toBe(false)

    expect(globalShortcut.isRegistered(accelerator)).toBe(false)
    globalShortcut.register(accelerator, () => {})
    expect(globalShortcut.isRegistered(accelerator)).toBe(true)
    globalShortcut.unregisterAll()
    expect(globalShortcut.isRegistered(accelerator)).toBe(false)
  })
})
