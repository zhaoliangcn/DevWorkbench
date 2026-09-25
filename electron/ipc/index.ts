import { registerSshIpc } from './ssh.js'
import { registerSystemIpc } from './system.js'
import { registerDataIpc } from './data.js'

function registerToolboxIpc() {
  registerSystemIpc()
  registerDataIpc()
  registerSshIpc()
}

export { registerToolboxIpc }
