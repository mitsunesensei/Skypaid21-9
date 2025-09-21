// Main Electron Process - SkyParty Desktop App
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');

let mainWindow;
let loadingWindow;

function createLoadingWindow() {
    // Create loading window
    loadingWindow = new BrowserWindow({
        width: 500,
        height: 400,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false
        },
        icon: path.join(__dirname, 'icon.png'),
        title: 'SkyParty - Connecting...',
        show: true,
        frame: true, // Show frame for loading window
        backgroundColor: '#667eea'
    });

    // Load loading screen
    loadingWindow.loadFile('loading.html');

    // Handle loading window close
    loadingWindow.on('closed', () => {
        loadingWindow = null;
    });
}

function createMainWindow() {
    // Create the main browser window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false // Allow external resources like Firebase
        },
        icon: path.join(__dirname, 'icon.png'),
        title: 'SkyParty Desktop',
        show: false,
        frame: false, // Remove default window frame
        titleBarStyle: 'hidden', // Hide title bar
        transparent: false,
        backgroundColor: '#5A7FCC' // Match your HTML background
    });

    // Load local HTML file directly
    mainWindow.loadFile('skypartyonline2.html');

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        console.log('🚀 SkyParty Desktop App Started!');
    });

    // Open DevTools in development
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        require('electron').shell.openExternal(url);
        return { action: 'deny' };
    });
}

// Create application menu
function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Game',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow.webContents.send('menu-new-game');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Exit',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        mainWindow.reload();
                    }
                },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Actual Size',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => {
                        mainWindow.webContents.setZoomLevel(0);
                    }
                },
                {
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: () => {
                        const currentZoom = mainWindow.webContents.getZoomLevel();
                        mainWindow.webContents.setZoomLevel(currentZoom + 0.5);
                    }
                },
                {
                    label: 'Zoom Out',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => {
                        const currentZoom = mainWindow.webContents.getZoomLevel();
                        mainWindow.webContents.setZoomLevel(currentZoom - 0.5);
                    }
                }
            ]
        },
        {
            label: 'Window',
            submenu: [
                {
                    label: 'Minimize',
                    accelerator: 'CmdOrCtrl+M',
                    click: () => {
                        mainWindow.minimize();
                    }
                },
                {
                    label: 'Close',
                    accelerator: 'CmdOrCtrl+W',
                    click: () => {
                        mainWindow.close();
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About SkyParty',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About SkyParty',
                            message: 'SkyParty Desktop App',
                            detail: 'Windows XP Style Game Launcher\nVersion 1.0.0\nBuilt with Electron'
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// App event handlers
app.whenReady().then(() => {
    createMainWindow(); // Start directly with main app
    // createMenu(); // Commented out to keep clean Windows XP style
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(); // Start directly with main app
    }
});

// IPC Handlers for app functionality
ipcMain.handle('app:get-version', () => {
    return app.getVersion();
});

// Data persistence handlers
ipcMain.handle('data:save', (event, key, data) => {
    try {
        const userDataPath = app.getPath('userData');
        const fs = require('fs');
        const path = require('path');
        const dataPath = path.join(userDataPath, 'skyparty-data.json');
        
        let allData = {};
        if (fs.existsSync(dataPath)) {
            allData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
        
        allData[key] = data;
        fs.writeFileSync(dataPath, JSON.stringify(allData, null, 2));
        return { success: true };
    } catch (error) {
        console.error('Save data error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('data:load', (event, key) => {
    try {
        const userDataPath = app.getPath('userData');
        const fs = require('fs');
        const path = require('path');
        const dataPath = path.join(userDataPath, 'skyparty-data.json');
        
        if (fs.existsSync(dataPath)) {
            const allData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            return { success: true, data: allData[key] || null };
        }
        return { success: true, data: null };
    } catch (error) {
        console.error('Load data error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('data:load-all', () => {
    try {
        const userDataPath = app.getPath('userData');
        const fs = require('fs');
        const path = require('path');
        const dataPath = path.join(userDataPath, 'skyparty-data.json');
        
        if (fs.existsSync(dataPath)) {
            const allData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            return { success: true, data: allData };
        }
        return { success: true, data: {} };
    } catch (error) {
        console.error('Load all data error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('app:show-message', async (event, { type, title, message }) => {
    const result = await dialog.showMessageBox(mainWindow, {
        type: type || 'info',
        title: title || 'SkyParty',
        message: message || 'Message',
        buttons: ['OK']
    });
    return result;
});

ipcMain.handle('app:show-confirm', async (event, { title, message }) => {
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: title || 'Confirm',
        message: message || 'Are you sure?',
        buttons: ['Yes', 'No'],
        defaultId: 0,
        cancelId: 1
    });
    return result.response === 0;
});

// Handle opening main app from loading screen
ipcMain.handle('app:open-main-app', async () => {
    if (loadingWindow) {
        loadingWindow.close();
    }
    
    if (!mainWindow) {
        createMainWindow();
    }
    
    mainWindow.show();
    mainWindow.focus();
});

ipcMain.handle('app:show-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'All Files', extensions: ['*'] },
            { name: 'Images', extensions: ['jpg', 'png', 'gif'] },
            { name: 'Text Files', extensions: ['txt'] }
        ]
    });
    return result;
});

ipcMain.handle('app:minimize-window', () => {
    mainWindow.minimize();
});

ipcMain.handle('app:maximize-window', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.handle('app:close-window', () => {
    mainWindow.close();
});

// Handle app protocol for deep linking (optional)
app.setAsDefaultProtocolClient('skyparty');

console.log('🔧 SkyParty Desktop App IPC Handlers registered');
console.log('📱 App ready to launch!');
