import Utils from "../Utils";
import Recording from "../Recording";

const { getInstancePath, getInstanceByPath } = Utils;
const { beginRecording, finishRecording } = Recording;

const LightingService = game.GetService("Lighting");

function getOrCreate<T extends Instance>(className: string): T {
	const existing = LightingService.FindFirstChildOfClass(className as keyof Instances);
	if (existing) return existing as T;
	const inst = new Instance(className as keyof CreatableInstances);
	inst.Parent = LightingService;
	return inst as T;
}

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

function setPostProcessing(requestData: Record<string, unknown>) {
	const recordingId = beginRecording("Set post-processing effects");
	const created: string[] = [];

	const [success, err] = pcall(() => {
		if (requestData.bloom) {
			const b = requestData.bloom as Record<string, number>;
			const bloom = getOrCreate<BloomEffect>("BloomEffect");
			if (b.intensity !== undefined) bloom.Intensity = b.intensity;
			if (b.size !== undefined) bloom.Size = b.size;
			if (b.threshold !== undefined) bloom.Threshold = b.threshold;
			created.push("BloomEffect");
		}
		if (requestData.colorCorrection) {
			const c = requestData.colorCorrection as Record<string, unknown>;
			const cc = getOrCreate<ColorCorrectionEffect>("ColorCorrectionEffect");
			if (c.saturation !== undefined) cc.Saturation = c.saturation as number;
			if (c.contrast !== undefined) cc.Contrast = c.contrast as number;
			if (c.tintColor !== undefined) {
				const tc = c.tintColor as number[];
				cc.TintColor = Color3.fromRGB(tc[0] ?? 255, tc[1] ?? 255, tc[2] ?? 255);
			}
			created.push("ColorCorrectionEffect");
		}
		if (requestData.sunRays) {
			const s = requestData.sunRays as Record<string, number>;
			const sr = getOrCreate<SunRaysEffect>("SunRaysEffect");
			if (s.intensity !== undefined) sr.Intensity = s.intensity;
			if (s.spread !== undefined) sr.Spread = s.spread;
			created.push("SunRaysEffect");
		}
		if (requestData.depthOfField) {
			const d = requestData.depthOfField as Record<string, number>;
			const dof = getOrCreate<DepthOfFieldEffect>("DepthOfFieldEffect");
			if (d.farIntensity !== undefined) dof.FarIntensity = d.farIntensity;
			if (d.focusDistance !== undefined) dof.FocusDistance = d.focusDistance;
			if (d.inFocusRadius !== undefined) dof.InFocusRadius = d.inFocusRadius;
			created.push("DepthOfFieldEffect");
		}
		if (requestData.blur) {
			const b = requestData.blur as Record<string, number>;
			const blur = getOrCreate<BlurEffect>("BlurEffect");
			if (b.size !== undefined) blur.Size = b.size;
			created.push("BlurEffect");
		}
	});
	finishRecording(recordingId, success);

	if (success) return { success: true, effects: created };
	return { error: `Failed to set post-processing: ${tostring(err)}` };
}

function createVfxPreset(requestData: Record<string, unknown>) {
	const preset = requestData.preset as string;
	const targetPath = requestData.target as string;
	const scale = (requestData.scale as number | undefined) ?? 1;
	const colorRaw = requestData.color as number[] | undefined;

	if (!preset || !targetPath) return { error: "preset and target are required" };
	const validPresets = ["explosion", "fire", "magic_aura", "hit_effect", "smoke"];
	if (!validPresets.includes(preset)) {
		return { error: `Unknown preset: ${preset}. Valid: ${validPresets.join(", ")}` };
	}

	const targetInst = getInstanceByPath(targetPath);
	if (!targetInst) return { error: `Target not found: ${targetPath}` };

	const c = colorRaw ?? [255, 150, 0];
	const mainColor = Color3.fromRGB(c[0] ?? 255, c[1] ?? 150, c[2] ?? 0);
	const created: string[] = [];
	const recordingId = beginRecording(`VFX preset: ${preset}`);

	const [success, err] = pcall(() => {
		if (preset === "explosion") {
			const light = new Instance("PointLight");
			light.Brightness = 20 * scale;
			light.Range = 30 * scale;
			light.Color = mainColor;
			light.Parent = targetInst;
			created.push(getInstancePath(light));

			const burst = new Instance("ParticleEmitter");
			burst.Name = "ExplosionBurst";
			burst.Rate = 500;
			burst.Lifetime = new NumberRange(0.1 * scale, 0.3 * scale);
			burst.Speed = new NumberRange(10 * scale, 30 * scale);
			burst.Color = new ColorSequence(mainColor);
			burst.LightEmission = 0.8;
			burst.Parent = targetInst;
			created.push(getInstancePath(burst));

			const smoke = new Instance("ParticleEmitter");
			smoke.Name = "ExplosionSmoke";
			smoke.Rate = 20;
			smoke.Lifetime = new NumberRange(1 * scale, 2 * scale);
			smoke.Speed = new NumberRange(2, 5);
			smoke.Color = new ColorSequence(Color3.fromRGB(100, 100, 100));
			smoke.Parent = targetInst;
			created.push(getInstancePath(smoke));

		} else if (preset === "fire") {
			const fire = new Instance("Fire");
			(fire as unknown as { Size: number }).Size = 5 * scale;
			(fire as unknown as { Heat: number }).Heat = 9 * scale;
			(fire as unknown as { Color: Color3 }).Color = mainColor;
			fire.Parent = targetInst;
			created.push(getInstancePath(fire));

			const smokeInst = new Instance("Smoke");
			(smokeInst as unknown as { RiseVelocity: number }).RiseVelocity = 4;
			(smokeInst as unknown as { Density: number }).Density = 0.3;
			smokeInst.Parent = targetInst;
			created.push(getInstancePath(smokeInst));

		} else if (preset === "magic_aura") {
			const aura = new Instance("ParticleEmitter");
			aura.Name = "MagicAura";
			aura.Rate = 30 * scale;
			aura.Lifetime = new NumberRange(0.5, 1.5);
			aura.Speed = new NumberRange(1, 3);
			aura.SpreadAngle = new Vector2(360, 360);
			aura.Color = new ColorSequence(mainColor);
			aura.LightEmission = 0.6;
			aura.Parent = targetInst;
			created.push(getInstancePath(aura));

			const light2 = new Instance("PointLight");
			light2.Color = mainColor;
			light2.Brightness = 3 * scale;
			light2.Range = 10 * scale;
			light2.Parent = targetInst;
			created.push(getInstancePath(light2));

		} else if (preset === "hit_effect") {
			const hit = new Instance("ParticleEmitter");
			hit.Name = "HitEffect";
			hit.Rate = 1000;
			hit.Lifetime = new NumberRange(0.05, 0.15);
			hit.Speed = new NumberRange(5 * scale, 15 * scale);
			hit.SpreadAngle = new Vector2(180, 180);
			hit.Color = new ColorSequence(mainColor);
			hit.LightEmission = 1;
			hit.Parent = targetInst;
			created.push(getInstancePath(hit));

			const flash = new Instance("PointLight");
			flash.Color = mainColor;
			flash.Brightness = 10 * scale;
			flash.Range = 15 * scale;
			flash.Parent = targetInst;
			created.push(getInstancePath(flash));

		} else if (preset === "smoke") {
			const nativeSmoke = new Instance("Smoke");
			(nativeSmoke as unknown as { RiseVelocity: number }).RiseVelocity = 3 * scale;
			(nativeSmoke as unknown as { Density: number }).Density = 0.5;
			(nativeSmoke as unknown as { Color: Color3 }).Color = Color3.fromRGB(180, 180, 180);
			nativeSmoke.Parent = targetInst;
			created.push(getInstancePath(nativeSmoke));

			const smokeParticles = new Instance("ParticleEmitter");
			smokeParticles.Name = "SmokeParticles";
			smokeParticles.Rate = 5 * scale;
			smokeParticles.Lifetime = new NumberRange(2, 4);
			smokeParticles.Speed = new NumberRange(1, 3);
			smokeParticles.Color = new ColorSequence(Color3.fromRGB(160, 160, 160));
			smokeParticles.LightInfluence = 1;
			smokeParticles.Parent = targetInst;
			created.push(getInstancePath(smokeParticles));
		}
	});
	finishRecording(recordingId, success);

	if (success) return { success: true, preset, target: targetPath, created };
	return { error: `Failed to create VFX preset: ${tostring(err)}` };
}

export = { createLight, createParticleEffect, createBeam, createTrail, setPostProcessing, createVfxPreset };
