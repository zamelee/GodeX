import type { ResponsesContext } from "../context/responses-context";
import type {
	FunctionCall,
	FunctionCallOutput,
	Reasoning,
	ResponseItem,
	ResponseObject,
	ResponseOutputMessage,
	ResponseStreamEvent,
} from "../protocol/openai/responses";

/**
 * Wrap a completed {@link ResponseObject} as a `ReadableStream<ResponseStreamEvent>`
 * that emits the standard Responses API SSE event sequence.
 *
 * Why this exists (Path D, stream-mode agentic loop):
 *
 * The {@link BrowserFunctionLoop} runs synchronously to absorb any
 * `godex_chrome_*` function calls. That produces a finished `ResponseObject`
 * whose `output` array already contains the final `message` plus any
 * intermediate `function_call` / `function_call_output` / `reasoning` items
 * the loop collected along the way.
 *
 * Codex++ issues requests with `stream: true`, so we cannot just hand back
 * a `Response.json` (it would never get parsed as SSE and Codex would lose
 * the streaming connection). Instead we replay the result through the same
 * SSE event shape the client expects:
 *
 *   response.created
 *   response.in_progress
 *   for each output item:
 *     response.output_item.added
 *     (per-item deltas — reasoning text, function arguments, output text, image)
 *     response.output_item.done
 *   response.completed
 *
 * Function call and function_call_output items are still emitted (the model
 * may have produced several rounds of them), but Codex does not need to
 * execute them locally — GodeX already executed them server-side. Codex
 * only consumes the final `output_text` (or image content parts) in the
 * terminal `response.completed` event.
 */
export function wrapResponseObjectAsSseStream(
	response: ResponseObject,
	_ctx?: ResponsesContext,
): ReadableStream<ResponseStreamEvent> {
	const items = response.output;
	return new ReadableStream<ResponseStreamEvent>({
		start(controller) {
			let seq = 0;
			const next = (): number => seq++;

			// Build a copy of the response with an empty output for the
			// response.created event, so the client sees the response shell
			// appear before any items start streaming in.
			const shell: ResponseObject = { ...response, output: [] };

			enqueueEvent(controller, next(), {
				type: "response.created",
				response: shell,
			});
			enqueueEvent(controller, next(), {
				type: "response.in_progress",
				response: shell,
			});

			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (!item) continue;
				enqueueItemEvents(controller, next, i, item);
			}

			const terminalType =
				response.status === "failed"
					? "response.failed"
					: response.status === "incomplete"
						? "response.incomplete"
						: response.status === "cancelled"
							? "response.cancelled"
							: "response.completed";
			enqueueEvent(controller, next(), {
				type: terminalType,
				response,
			});
			controller.close();
		},
	});
}

function enqueueEvent(
	controller: ReadableStreamDefaultController<ResponseStreamEvent>,
	sequenceNumber: number,
	event: ResponseStreamEvent,
): void {
	controller.enqueue({ ...event, sequence_number: sequenceNumber });
}

function enqueueItemEvents(
	controller: ReadableStreamDefaultController<ResponseStreamEvent>,
	next: () => number,
	outputIndex: number,
	item: ResponseItem,
): void {
	enqueueEvent(controller, next(), {
		type: "response.output_item.added",
		output_index: outputIndex,
		item,
	});

	switch (item.type) {
		case "reasoning":
			enqueueReasoningEvents(controller, next, outputIndex, item);
			break;
		case "function_call":
			enqueueFunctionCallEvents(controller, next, outputIndex, item);
			break;
		case "function_call_output":
		case "web_search_call":
		case "file_search_call":
		case "computer_call":
		case "local_shell_call":
		case "apply_patch_call":
		case "mcp_call":
		case "mcp_list_tools":
		case "mcp_approval_request":
		case "tool_search_call":
		case "tool_search_output":
		case "image_generation_call":
		case "code_interpreter_call":
		case "custom_tool_call":
		case "compaction":
			// Items that have no per-item content deltas in the Responses API
			// event vocabulary. They go straight from added to done.
			break;
		case "message":
			// EasyInputMessage / ResponseInputMessage share type="message" but
			// are never part of `response.output` (which only carries assistant
			// turns). If we somehow see one here, just emit the added/done pair.
			if (
				!("status" in item) ||
				!("id" in item) ||
				(item as { role?: string }).role !== "assistant"
			) {
				break;
			}
			enqueueMessageEvents(controller, next, outputIndex, item);
			break;
		default:
			// Future ResponseItem variants land here. We do not emit per-item
			// deltas; just let the output_item.added / output_item.done pair
			// carry the item. The caller will see the new shape in the
			// response.completed payload.
			break;
	}

	enqueueEvent(controller, next(), {
		type: "response.output_item.done",
		output_index: outputIndex,
		item,
	});
}

function enqueueReasoningEvents(
	controller: ReadableStreamDefaultController<ResponseStreamEvent>,
	next: () => number,
	outputIndex: number,
	item: Reasoning,
): void {
	const content = item.content ?? [];
	for (let ci = 0; ci < content.length; ci++) {
		const part = content[ci];
		if (!part) continue;
		if (part.type !== "reasoning_text") continue;
		enqueueEvent(controller, next(), {
			type: "response.reasoning_text_part.added",
			item_id: item.id,
			output_index: outputIndex,
			content_index: ci,
			part: { type: "reasoning_text", text: "" },
		});
		enqueueEvent(controller, next(), {
			type: "response.reasoning_text.delta",
			item_id: item.id,
			output_index: outputIndex,
			content_index: ci,
			delta: part.text,
		});
		enqueueEvent(controller, next(), {
			type: "response.reasoning_text.done",
			item_id: item.id,
			output_index: outputIndex,
			content_index: ci,
			text: part.text,
		});
		enqueueEvent(controller, next(), {
			type: "response.reasoning_text_part.done",
			item_id: item.id,
			output_index: outputIndex,
			content_index: ci,
			part: part,
		});
	}
}

function enqueueFunctionCallEvents(
	controller: ReadableStreamDefaultController<ResponseStreamEvent>,
	next: () => number,
	outputIndex: number,
	item: FunctionCall,
): void {
	enqueueEvent(controller, next(), {
		type: "response.function_call_arguments.delta",
		item_id: item.call_id,
		output_index: outputIndex,
		delta: item.arguments,
	});
	enqueueEvent(controller, next(), {
		type: "response.function_call_arguments.done",
		item_id: item.call_id,
		output_index: outputIndex,
		arguments: item.arguments,
	});
}

function enqueueMessageEvents(
	controller: ReadableStreamDefaultController<ResponseStreamEvent>,
	next: () => number,
	outputIndex: number,
	item: ResponseOutputMessage,
): void {
	for (let ci = 0; ci < item.content.length; ci++) {
		const part = item.content[ci];
		if (!part) continue;
		enqueueEvent(controller, next(), {
			type: "response.content_part.added",
			item_id: item.id,
			output_index: outputIndex,
			content_index: ci,
			part,
		});
		if (part.type === "output_text") {
			enqueueEvent(controller, next(), {
				type: "response.output_text.delta",
				item_id: item.id,
				output_index: outputIndex,
				content_index: ci,
				delta: part.text,
			});
			enqueueEvent(controller, next(), {
				type: "response.output_text.done",
				item_id: item.id,
				output_index: outputIndex,
				content_index: ci,
				text: part.text,
			});
		} else if (part.type === "refusal") {
			enqueueEvent(controller, next(), {
				type: "response.refusal.delta",
				item_id: item.id,
				output_index: outputIndex,
				content_index: ci,
				delta: part.refusal,
			});
			enqueueEvent(controller, next(), {
				type: "response.refusal.done",
				item_id: item.id,
				output_index: outputIndex,
				content_index: ci,
				refusal: part.refusal,
			});
		}
		enqueueEvent(controller, next(), {
			type: "response.content_part.done",
			item_id: item.id,
			output_index: outputIndex,
			content_index: ci,
			part,
		});
	}
}

/**
 * Strip items that the client should not be asked to execute locally
 * (Path D function calls already ran server-side, so we collapse them to
 * a single synthetic event stream). Today this is a no-op: function_call
 * and function_call_output are still emitted as items for diagnostic
 * transparency, but the client (Codex++) is told via `response.completed`
 * that the response is final and no further tool execution is needed.
 *
 * Kept as a hook in case future versions want to suppress these items.
 */
export function _suppressedToolItems(
	_item: ResponseItem,
): _item is FunctionCall | FunctionCallOutput {
	return (
		_item.type === "function_call" || _item.type === "function_call_output"
	);
}
