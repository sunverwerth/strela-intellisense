/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { StrelaDebugSession } from './StrelaDebugSession';
import { ChildProcess, spawn } from 'child_process';
import { StreamInfo, LanguageClientOptions, LanguageClient } from 'vscode-languageclient';
import * as net from 'net';
import * as url from 'url';

/*
 * Set the following compile time flag to true if the
 * debug adapter should run inside the extension host.
 * Please note: the test suite does no longer work in this mode.
 */
const EMBED_DEBUG_ADAPTER = true;

export function activate(context: vscode.ExtensionContext) {
	// DEBUGGER

	// register a configuration provider for 'strela' debug type
	const provider = new StrelaConfigurationProvider()
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('strela', provider));
	context.subscriptions.push(provider);

	// LSP
    const serverOptions = () => new Promise<ChildProcess | StreamInfo>((resolve, reject) => {
        // Use a TCP socket because of problems with blocking STDIO
        const server = net.createServer(socket => {
            // 'connection' listener
            console.log('Strela LSP connected');
            socket.on('end', () => {
                console.log('Strela LSP disconnected');
            });
            server.close();
            resolve({ reader: socket, writer: socket } as StreamInfo);
		});

		// Listen on random port
        server.listen(31337, '127.0.0.1', () => {
			// The server is implemented in strela
			let port = server.address().port.toString();
			console.log(port);
            /*const childProcess = spawn('strela', [
				context.asAbsolutePath('language-server/LanguageServer.strela'),
                port
            ], {
			});
            childProcess.stderr.on('data', (chunk: Buffer) => {
                console.log(chunk.toString());
            });
            childProcess.stdout.on('data', (chunk: Buffer) => {
                console.log(chunk.toString());
			});
			childProcess.on('exit', function (code) {
				console.log('LSP process exited with code ' + code.toString());
			});
            return childProcess;*/
        });
    });

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for strela documents
        documentSelector: [
            { scheme: 'file', language: 'strela' },
            { scheme: 'untitled', language: 'strela' }
        ],
        uriConverters: {
            // VS Code by default %-encodes even the colon after the drive letter
            // NodeJS handles it much better
            code2Protocol: uri => url.format(url.parse(uri.toString(true))),
            protocol2Code: str => vscode.Uri.parse(str)
        },
        synchronize: {
            // Synchronize the setting section 'strela' to the server
            configurationSection: 'strela',
            // Notify the server about changes to strela files in the workspace
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.strela')
        }
    };

    // Create the language client and start the client.
    const disposable = new LanguageClient('Strela Language Server', serverOptions, clientOptions).start();

    // Push the disposable to the context's subscriptions so that the
    // client can be deactivated on extension deactivation
	context.subscriptions.push(disposable);
}

export function deactivate() {
	console.log("deactivate");
	// nothing to do
}

class StrelaConfigurationProvider implements vscode.DebugConfigurationProvider {

	private _server?: net.Server;

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		console.log("resolveDebugConfiguration");
		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'strela' ) {
				config.type = 'strela';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.args = [];
				config.stopOnEntry = true;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		if (EMBED_DEBUG_ADAPTER) {
			// start port listener on launch of first debug session
			if (!this._server) {

				// start listening on a random port
				this._server = net.createServer(socket => {
					const session = new StrelaDebugSession();
					session.setRunAsServer(true);
					session.start(<NodeJS.ReadableStream>socket, socket);
				}).listen(0);
			}

			// make VS Code connect to debug server instead of launching debug adapter
			config.debugServer = this._server.address().port;
		}

		return config;
	}

	dispose() {
		if (this._server) {
			this._server.close();
		}
	}
}
