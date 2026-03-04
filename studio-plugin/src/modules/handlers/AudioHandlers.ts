import Utils from "../Utils";
import Recording from "../Recording";

const { getInstancePath, getInstanceByPath } = Utils;
const { beginRecording, finishRecording } = Recording;

function createSound(requestData: Record<string, unknown>) {
	const parentPath = requestData.parent as string;
	if (!parentPath) return { error: "parent is required" };

	const parentInst = getInstanceByPath(parentPath);
	if (!parentInst) return { error: `Parent not found: ${parentPath}` };

	const recordingId = beginRecording("Create Sound");
	const [success, sound] = pcall(() => {
		const s = new Instance("Sound");
		if (requestData.soundId) s.SoundId = requestData.soundId as string;
		if (requestData.name) s.Name = requestData.name as string;
		if (requestData.volume !== undefined) s.Volume = requestData.volume as number;
		if (requestData.looped !== undefined) s.Looped = requestData.looped as boolean;
		if (requestData.rollOffMaxDistance !== undefined) {
			(s as unknown as { RollOffMaxDistance: number }).RollOffMaxDistance = requestData.rollOffMaxDistance as number;
		}
		if (requestData.pitch !== undefined) s.PlaybackSpeed = requestData.pitch as number;
		s.Parent = parentInst;
		return s;
	});
	finishRecording(recordingId, success);

	if (success && sound) {
		const s = sound as Sound;
		return { success: true, path: getInstancePath(s), soundId: s.SoundId };
	}
	return { error: `Failed to create Sound: ${tostring(sound)}` };
}

export = { createSound };
