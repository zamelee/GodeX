// Studio Hooks — Layer 3.5 will remove godex hardcode and enable these.
//
// Currently godex builtin MINIMAX_PROVIDER_SPEC already handles all MiniMax quirks.
// Studio hooks are pass-through to avoid double-processing.
// When godex minimax hooks are stripped, these will take over.
import type { GodexPlugin } from "../../src/bridge/plugins";

const PLUGINS: GodexPlugin = {
	name: "studio",
	hooks: {
		// Pass-through until godex hardcode is removed (Layer 3.5)
		transformChatMessages: (messages) => [...messages],

		// Pass-through until godex hardcode is removed (Layer 3.5)
		patchRequest: (request) => request,

		// Pass-through until godex hardcode is removed (Layer 3.5)
		transformStreamDelta: (delta) => delta,
	},
};

export default PLUGINS;