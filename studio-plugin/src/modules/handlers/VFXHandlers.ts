import Utils from "../Utils";
import Recording from "../Recording";

const { getInstancePath, getInstanceByPath } = Utils;
const { beginRecording, finishRecording } = Recording;

// Helper: build ColorSequence from [{time, rgb}] array
function buildColorSequence(data: Array<{ time: number; rgb: number[] }>): ColorSequence {
	if (data.size() === 0) return new ColorSequence(Color3.fromRGB(255, 255, 255));
	const kps: ColorSequenceKeypoint[] = [];
	for (const kp of data) {
		kps.push(new ColorSequenceKeypoint(
			kp.time,
			Color3.fromRGB(kp.rgb[0] ?? 255, kp.rgb[1] ?? 255, kp.rgb[2] ?? 255),
		));
	}
	return new ColorSequence(kps);
}

// Helper: build NumberSequence from [{time, value}] array
function buildNumberSequence(data: Array<{ time: number; value: number }>): NumberSequence {
	if (data.size() === 0) return new NumberSequence(1);
	const kps: NumberSequenceKeypoint[] = [];
	for (const kp of data) {
		kps.push(new NumberSequenceKeypoint(kp.time, kp.value));
	}
	return new NumberSequence(kps);
}

function createLight(requestData: Record<string, unknown>) {
	const lightType = requestData.type as string;
	const parentPath = requestData.parent as string;
	if (!parentPath) return { error: "parent is required" };

	const validTypes = ["PointLight", "SpotLight", "SurfaceLight"];
	if (!lightType || !validTypes.includes(lightType)) {
		return { error: `type must be one of: ${validTypes.join(", ")}` };
	}

	const parentInst = getInstanceByPath(parentPath);
	if (!parentInst) return { error: `Parent not found: ${parentPath}` };

	const brightness = (requestData.brightness as number | undefined) ?? 1;
	const range = (requestData.range as number | undefined) ?? 16;
	const colorRaw = requestData.color as number[] | undefined;
	const color = colorRaw
		? Color3.fromRGB(colorRaw[0] ?? 255, colorRaw[1] ?? 255, colorRaw[2] ?? 255)
		: Color3.fromRGB(255, 255, 255);
	const enabled = requestData.enabled !== false;

	const recordingId = beginRecording(`Create ${lightType}`);
	const [success, light] = pcall(() => {
		const l = new Instance(lightType as keyof CreatableInstances);
		(l as unknown as { Brightness: number }).Brightness = brightness;
		(l as unknown as { Range: number }).Range = range;
		(l as unknown as { Color: Color3 }).Color = color;
		(l as unknown as { Enabled: boolean }).Enabled = enabled;
		l.Parent = parentInst;
		return l;
	});
	finishRecording(recordingId, success);

	if (success && light) {
		return { success: true, type: lightType, path: getInstancePath(light as Instance) };
	}
	return { error: `Failed to create ${lightType}: ${tostring(light)}` };
}

function createParticleEffect(requestData: Record<string, unknown>) {
	const parentPath = requestData.parent as string;
	if (!parentPath) return { error: "parent is required" };
	const parentInst = getInstanceByPath(parentPath);
	if (!parentInst) return { error: `Parent not found: ${parentPath}` };

	const recordingId = beginRecording("Create ParticleEmitter");
	const [success, emitter] = pcall(() => {
		const pe = new Instance("ParticleEmitter");
		if (requestData.name) pe.Name = requestData.name as string;
		if (requestData.rate !== undefined) pe.Rate = requestData.rate as number;
		if (requestData.lifetime !== undefined) {
			const lt = requestData.lifetime as number[];
			pe.Lifetime = new NumberRange(lt[0] ?? 1, lt[1] ?? 1);
		}
		if (requestData.speed !== undefined) {
			const sp = requestData.speed as number[];
			pe.Speed = new NumberRange(sp[0] ?? 5, sp[1] ?? 5);
		}
		if (requestData.color !== undefined) {
			pe.Color = buildColorSequence(requestData.color as Array<{ time: number; rgb: number[] }>);
		}
		if (requestData.size !== undefined) {
			pe.Size = buildNumberSequence(requestData.size as Array<{ time: number; value: number }>);
		}
		if (requestData.transparency !== undefined) {
			pe.Transparency = buildNumberSequence(requestData.transparency as Array<{ time: number; value: number }>);
		}
		if (requestData.lightEmission !== undefined) pe.LightEmission = requestData.lightEmission as number;
		if (requestData.lightInfluence !== undefined) pe.LightInfluence = requestData.lightInfluence as number;
		if (requestData.texture !== undefined) pe.Texture = requestData.texture as string;
		if (requestData.rotSpeed !== undefined) {
			const rs = requestData.rotSpeed as number[];
			pe.RotSpeed = new NumberRange(rs[0] ?? 0, rs[1] ?? 0);
		}
		if (requestData.rotation !== undefined) {
			const r = requestData.rotation as number[];
			pe.Rotation = new NumberRange(r[0] ?? 0, r[1] ?? 0);
		}
		if (requestData.acceleration !== undefined) {
			const acc = requestData.acceleration as number[];
			pe.Acceleration = new Vector3(acc[0] ?? 0, acc[1] ?? 0, acc[2] ?? 0);
		}
		if (requestData.spreadAngle !== undefined) {
			const sa = requestData.spreadAngle as number[];
			pe.SpreadAngle = new Vector2(sa[0] ?? 0, sa[1] ?? 0);
		}
		if (requestData.enabled !== undefined) pe.Enabled = requestData.enabled as boolean;
		pe.Parent = parentInst;
		return pe;
	});
	finishRecording(recordingId, success);

	if (success && emitter) {
		return { success: true, path: getInstancePath(emitter as Instance) };
	}
	return { error: `Failed to create ParticleEmitter: ${tostring(emitter)}` };
}

export = { createLight, createParticleEffect, buildColorSequence, buildNumberSequence };
