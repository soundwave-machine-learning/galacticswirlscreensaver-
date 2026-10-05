import './style.css';
import { readLaunchInfo } from './platform/host';
import { installScreensaverGuard } from './platform/screensaverGuard';

// Entry point. Screensaver input handling is installed first, before WebGL
// or any asset is touched, so the screen can always be dismissed even if
// something later fails. The renderer is loaded as a separate chunk.
const launch = readLaunchInfo();
if (launch.mode === 'screensaver') {
  document.documentElement.classList.add('screensaver');
  installScreensaverGuard();
}

import('./app')
  .then(({ boot, reportFatal }) => boot().catch(reportFatal))
  .catch((err) => {
    console.error(err);
  });
