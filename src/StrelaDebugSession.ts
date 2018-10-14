/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	Logger, logger,
	LoggingDebugSession,
	InitializedEvent, /*TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,*/
	Thread, /*StackFrame,*/ Scope, /*Source,*/ /*, Breakpoint*/
	StoppedEvent,
	StackFrame,
	Source,
	Breakpoint,
	OutputEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
/*import { basename } from 'path';*/
import * as net from 'net';
import * as ChildProcess from 'child_process';


/**
 * This interface describes the strela-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the strela-debug extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
	/** additional cmd line args */
	args: string[]
}

export class StrelaDebugSession extends LoggingDebugSession {

	private debugSocket: net.Socket;

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super("strela-debug.txt");

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = false;

		// make VS Code to show a 'step back' button
		response.body.supportsStepBack = false;

		this.sendResponse(response);
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {

		if (this.startBreakpoints) {
			this.startBreakpoints.forEach((bps: DebugProtocol.SetBreakpointsArguments, path: string) => {
				this.debugSocket.write("ADD_ALL_START\n");
				this.debugSocket.write(bps.breakpoints!.length + "\n");
				this.debugSocket.write(path + "\n");
				bps.breakpoints!.forEach((bp) => {
					this.debugSocket.write(bp.line + "\n");
				});
			});
		}

		this.debugSocket.write("START\n");
		super.configurationDoneRequest(response, args);
	}

	private lines: string[] = [];
	private currentLine = '';
	private responses: any[] = [];

	protected readSocket(data: String): void {
		this.currentLine += data;
		var idx: number;
		while ((idx = this.currentLine.indexOf('\n')) >= 0) {
			this.lines.push(this.currentLine.substr(0, idx));
			this.currentLine = this.currentLine.substr(idx + 1);
		}

		while (this.lines.length > 0) {
			if (this.lines[0] === 'ACK_STACK') {
				if (this.lines.length >= 2) {
					const numFrames = parseInt(this.lines[1]);
					if (this.lines.length >= 2 + numFrames * 3) {
						this.lines.shift();
						this.lines.shift();

						var response = this.responses.shift();
						if (response) {
							response.body = {
								stackFrames: [],
								totalFrames: numFrames
							};

							for (var i = 0; i < numFrames; ++i) {
								var file = this.lines.shift() || '';
								var line = parseInt(this.lines.shift() || '0');
								var name = this.lines.shift() || '';
								response.body.stackFrames.push(new StackFrame(i, name, new Source(file, file), line));
							}

							this.sendResponse(response);
						}
					}
					else {
						return;
					}
				}
				else {
					return;
				}
			}
			else if (this.lines[0] === 'ACK_THREADS') {
				if (this.lines.length >= 2) {
					const num = parseInt(this.lines[1]);
					if (this.lines.length >= 2 + num) {
						this.lines.shift();
						this.lines.shift();
						var response = this.responses.shift();
						response.body = {
							threads: []
						};
						for (var i = 0; i < num; ++i) {
							var name = this.lines.shift() || 'Thread #' + (i + 1);
							response.body.threads.push(new Thread(i, name));
						}
						this.sendResponse(response);
					}
					else {
						return;
					}
				}
				else {
					return;
				}
			}
			else if (this.lines[0] === 'ACK_ADD_ALL') {
				if (this.lines.length >= 2) {
					const num = parseInt(this.lines[1]);
					if (this.lines.length >= 2 + num) {
						this.lines.shift(); // ACK
						this.lines.shift(); // num

						var response = this.responses.shift();
						response.body = {
							breakpoints: []
						};
						for (var i = 0; i < num; ++i) {
							response.body.breakpoints.push(new Breakpoint(true, parseInt(this.lines.shift() || '')));
						}
						this.sendResponse(response);
					}
					else {
						return;
					}
				}
				else {
					return;
				}
			}
			else if (this.lines[0] === 'ACK_ADD') {
				this.lines.shift();
				this.sendResponse(this.responses.shift());
			}
			else if (this.lines[0] === 'ACK_REMOVE') {
				this.lines.shift();
				this.sendResponse(this.responses.shift());
			}
			else if (this.lines[0] === 'ACK_STEP') {
				this.lines.shift();
				this.sendResponse(this.responses.shift());
			}
			else if (this.lines[0] === 'ACK_STEPIN') {
				this.lines.shift();
				this.sendResponse(this.responses.shift());
			}
			else if (this.lines[0] === 'ACK_STEPOUT') {
				this.lines.shift();
				this.sendResponse(this.responses.shift());
			}
			else if (this.lines[0] === 'ACK_PAUSE') {
				this.lines.shift();
				this.sendResponse(this.responses.shift());
			}
			else if (this.lines[0] === 'ACK_CONTINUE') {
				this.lines.shift();
				this.sendResponse(this.responses.shift());
			}
			else if (this.lines[0] === 'HIT') {
				this.lines.shift();
				this.sendEvent(new StoppedEvent('breakpoint', 0));
			}
			else if (this.lines[0] === 'ACK_VARIABLES') {
				if (this.lines.length >= 2) {
					const num = parseInt(this.lines[1]);
					if (this.lines.length >= 2 + num * 5) {
						this.lines.shift(); //ACK
						this.lines.shift(); //NUM
						var response = this.responses.shift();

						const variables = new Array<DebugProtocol.Variable>();
						for (var i = 0; i < num; ++i) {
							variables.push({
								name: this.lines.shift() || '',
								type: this.lines.shift() || '',
								presentationHint: {
									kind: this.lines.shift() || ''
								},
								value: this.lines.shift() || '',
								variablesReference: parseInt(this.lines.shift() || '')
							});
						}

						response.body = {
							variables: variables
						};
						this.sendResponse(response);
					}
					else {
						return;
					}
				}
				else {
					return;
				}
			}
			else {
				console.error("Unknown command " + this.lines[0]);
				this.lines.shift();
			}
		}
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {

		// make sure to 'Stop' the buffered logging if 'trace' is not set
		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		// start the program in the runtime
		// Use a TCP socket because of problems with blocking STDIO
		const server = net.createServer(socket => {
			// 'connection' listener
			console.log('Strela process connected');
			socket.on('end', () => {
				console.log('Strela process disconnected');
			});
			server.close();

			socket.on('data', (data: Buffer) => {
				this.readSocket(data.toString());
			});

			this.debugSocket = socket;
			this.sendResponse(response);
			this.sendEvent(new InitializedEvent());
		});
		// Listen on random port
		server.listen(0, '127.0.0.1', () => {
			// The server is implemented in Strela
			let fullArgs = ['--debug', server.address().port.toString(), args.program].concat(args.args);
			let child = ChildProcess.spawn("strela", fullArgs, {
				detached: true,
				shell: true
			});

			child.stderr.on('data', chunk => this.sendEvent(new OutputEvent(chunk.toString(), 'stderr')));

			child.on('exit', (code) => {
				if (!this.debugSocket) {
					this.sendErrorResponse(response, code, "Error launching program.");
				}
			});
		});
	}

	private startBreakpoints: Map<string, DebugProtocol.SetBreakpointsArguments>;

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		if (!this.debugSocket) {
			this.startBreakpoints.set(args.source.path || '', args);
			this.sendResponse(response);
		}
		else {
			this.debugSocket.write("ADD_ALL\n");
			var bps = args.breakpoints || [];
			this.debugSocket.write(bps.length + "\n");
			this.debugSocket.write(args.source.path + "\n");
			for (var i = 0; i < bps.length; ++i) {
				this.debugSocket.write(bps[i].line + "\n");
			}

			this.responses.push(response);
		}
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		//this.debugSocket.write("THREADS\n");
		//this.responses.push(response);
		response.body = {
			threads: [
				new Thread(0, 'Main Thread')
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		this.debugSocket.write("STACK\n");
		this.responses.push(response);
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		this.debugSocket.write("DISCONNECT\n");
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		const scopes = new Array<Scope>();
		scopes.push(new Scope("Locals", args.frameId + 1, false));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		this.debugSocket.write("VARIABLES\n");
		this.debugSocket.write(args.variablesReference + "\n");
		this.responses.push(response);
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
		this.debugSocket.write("PAUSE\n");
		this.responses.push(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.debugSocket.write("CONTINUE\n");
		this.responses.push(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) {
		this.debugSocket.write("STEPIN\n");
		this.responses.push(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.debugSocket.write("STEP\n");
		this.responses.push(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this.debugSocket.write("STEPOUT\n");
		this.responses.push(response);
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		this.sendResponse(response);
	}

	//---- helpers

	/*private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mock-adapter-data');
	}*/
}
