// GodexStudio plugin — Layer 2 pass-through skeleton
//
// Hooks are no-ops at this stage. Each hook becomes a real transform
// in Layer 3 when we migrate MiniMax quirks out of godex.
import type { GodexPlugin } from "../../godex/src/bridge/plugins";

// Placeholder profiles; loaded from profiles.yaml in Layer 4.
const PLUGINS: GodexPlugin = {
	name: "studio",
	hooks: {
		// Hook A: transformChatMessages
		// Will handle image splitting, parallel reorder, orphan drop.
		transformChatMessages: (messages) => messages,

		// Hook B: patchRequest
		// Will handle tool args canonicalization, empty-string→{}, etc.
		patchRequest: (request) => request,

		// Hook C: transformStreamDelta
		// Will handle null filtering, reasoning_details extraction.
		transformStreamDelta: (delta) => delta,
	},
};

export default PLUGINS;
