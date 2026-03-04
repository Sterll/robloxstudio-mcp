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

function createBeam(requestData: Record<string, unknown>) {
	const att0Path = requestData.attachment0 as string;
	const att1Path = requestData.attachment1 as string;
	const parentPath = (requestData.parent as string) ?? att0Path;

	if (!att0Path || !att1Path) return { error: "attachment0 and attachment1 paths are required" };

	const att0 = getInstanceByPath(att0Path);
	const att1 = getInstanceByPath(att1Path);
	if (!att0) return { error: `attachment0 not found: ${att0Path}` };
	if (!att1) return { error: `attachment1 not found: ${att1Path}` };
	const parentInst = getInstanceByPath(parentPath) ?? att0;

	const recordingId = beginRecording("Create Beam");
	const [success, beam] = pcall(() => {
		const b = new Instance("Beam");
		b.Attachment0 = att0 as Attachment;
		b.Attachment1 = att1 as Attachment;
		if (requestData.width !== undefined) {
			const w = requestData.width as number;
			b.Width0 = w;
			b.Width1 = w;
		}
		if (requestData.color !== undefined) {
			b.Color = buildColorSequence(requestData.color as Array<{ time: number; rgb: number[] }>);
		}
		if (requestData.transparency !== undefined) {
			b.Transparency = buildNumberSequence(requestData.transparency as Array<{ time: number; value: number }>);
		}
		if (requestData.lightEmission !== undefined) b.LightEmission = requestData.lightEmission as number;
		if (requestData.texture !== undefined) b.Texture = requestData.texture as string;
		b.Parent = parentInst;
		return b;
	});
	finishRecording(recordingId, success);

	if (success && beam) return { success: true, path: getInstancePath(beam as Instance) };
	return { error: `Failed to create Beam: ${tostring(beam)}` };
}

function createTrail(requestData: Record<string, unknown>) {
	const parentPath = requestData.parent as string;
	if (!parentPath) return { error: "parent is required" };
	const parentInst = getInstanceByPath(parentPath);
	if (!parentInst) return { error: `Parent not found: ${parentPath}` };

	const recordingId = beginRecording("Create Trail");
	const [success, result] = pcall(() => {
		const att0 = new Instance("Attachment");
		att0.Name = "TrailAttachment0";
		att0.Parent = parentInst;

		const att1 = new Instance("Attachment");
		att1.Name = "TrailAttachment1";
		att1.Position = new Vector3(0, (requestData.attachmentOffset as number | undefined) ?? 1, 0);
		att1.Parent = parentInst;

		const t = new Instance("Trail");
		t.Attachment0 = att0;
		t.Attachment1 = att1;
		if (requestData.lifetime !== undefined) t.Lifetime = requestData.lifetime as number;
		if (requestData.minLength !== undefined) t.MinLength = requestData.minLength as number;
		if (requestData.color !== undefined) {
			t.Color = buildColorSequence(requestData.color as Array<{ time: number; rgb: number[] }>);
		}
		if (requestData.transparency !== undefined) {
			t.Transparency = buildNumberSequence(requestData.transparency as Array<{ time: number; value: number }>);
		}
		if (requestData.widthScale !== undefined) {
			t.WidthScale = buildNumberSequence(requestData.widthScale as Array<{ time: number; value: number }>);
		}
		if (requestData.lightEmission !== undefined) t.LightEmission = requestData.lightEmission as number;
		if (requestData.texture !== undefined) t.Texture = requestData.texture as string;
		t.Parent = parentInst;
		return { trail: t, att0, att1 };
	});
	finishRecording(recordingId, success);

	if (success && result) {
		const r = result as { trail: Instance; att0: Instance; att1: Instance };
		return {
			success: true,
			trailPath: getInstancePath(r.trail),
			attachment0Path: getInstancePath(r.att0),
			attachment1Path: getInstancePath(r.att1),
		};
	}
	return { error: `Failed to create Trail: ${tostring(result)}` };
}

export = { createLight, createParticleEffect, createBeam, createTrail, buildColorSequence, buildNumberSequence };
