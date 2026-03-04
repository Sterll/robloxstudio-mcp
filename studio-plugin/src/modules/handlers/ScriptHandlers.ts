import Utils from "../Utils";
import Recording from "../Recording";

const ScriptEditorService = game.GetService("ScriptEditorService");

const { getInstancePath, getInstanceByPath, readScriptSource, splitLines, joinLines } = Utils;
const { beginRecording, finishRecording } = Recording;

function normalizeEscapes(s: string): string {
	let result = s;
	result = result.gsub("\\n", "\n")[0];
	result = result.gsub("\\t", "\t")[0];
	result = result.gsub("\\r", "\r")[0];
	result = result.gsub("\\\\", "\\")[0];
	return result;
}

function getScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number | undefined;
	const endLine = requestData.endLine as number | undefined;

	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const [success, result] = pcall(() => {
		const fullSource = readScriptSource(instance);
		const [lines, hasTrailingNewline] = splitLines(fullSource);
		const totalLineCount = lines.size();

		let sourceToReturn = fullSource;
		let returnedStartLine = 1;
		let returnedEndLine = totalLineCount;

		if (startLine !== undefined || endLine !== undefined) {
			const actualStartLine = math.max(1, startLine ?? 1);
			const actualEndLine = math.min(lines.size(), endLine ?? lines.size());

			const selectedLines: string[] = [];
			for (let i = actualStartLine; i <= actualEndLine; i++) {
				selectedLines.push(lines[i - 1] ?? "");
			}

			sourceToReturn = selectedLines.join("\n");
			if (hasTrailingNewline && actualEndLine === lines.size() && sourceToReturn.sub(-1) !== "\n") {
				sourceToReturn += "\n";
			}
			returnedStartLine = actualStartLine;
			returnedEndLine = actualEndLine;
		}

		const numberedLines: string[] = [];
		const linesToNumber = startLine !== undefined ? splitLines(sourceToReturn)[0] : lines;
		const lineOffset = returnedStartLine - 1;
		for (let i = 0; i < linesToNumber.size(); i++) {
			numberedLines.push(`${i + 1 + lineOffset}: ${linesToNumber[i]}`);
		}
		const numberedSource = numberedLines.join("\n");

		const resp: Record<string, unknown> = {
			instancePath,
			className: instance.ClassName,
			name: instance.Name,
			source: sourceToReturn,
			numberedSource,
			sourceLength: fullSource.size(),
			lineCount: totalLineCount,
			startLine: returnedStartLine,
			endLine: returnedEndLine,
			isPartial: startLine !== undefined || endLine !== undefined,
			truncated: false,
		};

		if (startLine === undefined && endLine === undefined && fullSource.size() > 50000) {
			const truncatedLines: string[] = [];
			const truncatedNumberedLines: string[] = [];
			const maxLines = math.min(1000, lines.size());
			for (let i = 0; i < maxLines; i++) {
				truncatedLines.push(lines[i]);
				truncatedNumberedLines.push(`${i + 1}: ${lines[i]}`);
			}
			resp.source = truncatedLines.join("\n");
			resp.numberedSource = truncatedNumberedLines.join("\n");
			resp.truncated = true;
			resp.endLine = maxLines;
			resp.note = "Script truncated to first 1000 lines. Use startLine/endLine parameters to read specific sections.";
		}

		if (instance.IsA("BaseScript")) {
			resp.enabled = instance.Enabled;
		}
		return resp;
	});

	if (success) {
		return result;
	} else {
		return { error: `Failed to get script source: ${result}` };
	}
}

function setScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const newSource = requestData.source as string;

	if (!instancePath || !newSource) return { error: "Instance path and source are required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const sourceToSet = normalizeEscapes(newSource);
	const recordingId = beginRecording(`Set script source: ${instance.Name}`);

	const [updateSuccess, updateResult] = pcall(() => {
		const oldSourceLength = readScriptSource(instance).size();

		ScriptEditorService.UpdateSourceAsync(instance, () => sourceToSet);

		return {
			success: true, instancePath,
			oldSourceLength, newSourceLength: sourceToSet.size(),
			method: "UpdateSourceAsync",
			message: "Script source updated successfully (editor-safe)",
		};
	});

	if (updateSuccess) {
		finishRecording(recordingId, true);
		return updateResult;
	}

	const [directSuccess, directResult] = pcall(() => {
		const oldSource = (instance as unknown as { Source: string }).Source;
		(instance as unknown as { Source: string }).Source = sourceToSet;

		return {
			success: true, instancePath,
			oldSourceLength: oldSource.size(), newSourceLength: sourceToSet.size(),
			method: "direct",
			message: "Script source updated successfully (direct assignment)",
		};
	});

	if (directSuccess) {
		finishRecording(recordingId, true);
		return directResult;
	}

	const [replaceSuccess, replaceResult] = pcall(() => {
		const parent = instance.Parent;
		const name = instance.Name;
		const className = instance.ClassName;
		const wasBaseScript = instance.IsA("BaseScript");
		const enabled = wasBaseScript ? instance.Enabled : undefined;

		const newScript = new Instance(className as keyof CreatableInstances) as LuaSourceContainer;
		newScript.Name = name;
		(newScript as unknown as { Source: string }).Source = sourceToSet;
		if (wasBaseScript && enabled !== undefined) {
			(newScript as BaseScript).Enabled = enabled;
		}

		newScript.Parent = parent;
		instance.Destroy();

		return {
			success: true,
			instancePath: getInstancePath(newScript),
			method: "replace",
			message: "Script replaced successfully with new source",
		};
	});

	if (replaceSuccess) {
		finishRecording(recordingId, true);
		return replaceResult;
	}

	finishRecording(recordingId, false);
	return {
		error: `Failed to set script source. UpdateSourceAsync failed: ${updateResult}. Direct assignment failed: ${directResult}. Replace method failed: ${replaceResult}`,
	};
}

function editScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number;
	const endLine = requestData.endLine as number;
	let newContent = requestData.newContent as string;

	if (!instancePath || !startLine || !endLine || !newContent) {
		return { error: "Instance path, startLine, endLine, and newContent are required" };
	}

	newContent = normalizeEscapes(newContent);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Edit script lines ${startLine}-${endLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (startLine < 1 || startLine > totalLines) error(`startLine out of range (1-${totalLines})`);
		if (endLine < startLine || endLine > totalLines) error(`endLine out of range (${startLine}-${totalLines})`);

		const [newLines] = splitLines(newContent);
		const resultLines: string[] = [];

		for (let i = 0; i < startLine - 1; i++) resultLines.push(lines[i]);
		for (const line of newLines) resultLines.push(line);
		for (let i = endLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);

		return {
			success: true, instancePath,
			editedLines: { startLine, endLine },
			linesRemoved: endLine - startLine + 1,
			linesAdded: newLines.size(),
			newLineCount: resultLines.size(),
			message: "Script lines edited successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to edit script lines: ${result}` };
}

function insertScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const afterLine = (requestData.afterLine as number) ?? 0;
	let newContent = requestData.newContent as string;

	if (!instancePath || !newContent) return { error: "Instance path and newContent are required" };

	newContent = normalizeEscapes(newContent);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Insert script lines after line ${afterLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (afterLine < 0 || afterLine > totalLines) error(`afterLine out of range (0-${totalLines})`);

		const [newLines] = splitLines(newContent);
		const resultLines: string[] = [];

		for (let i = 0; i < afterLine; i++) resultLines.push(lines[i]);
		for (const line of newLines) resultLines.push(line);
		for (let i = afterLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);

		return {
			success: true, instancePath,
			insertedAfterLine: afterLine,
			linesInserted: newLines.size(),
			newLineCount: resultLines.size(),
			message: "Script lines inserted successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to insert script lines: ${result}` };
}

function deleteScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number;
	const endLine = requestData.endLine as number;

	if (!instancePath || !startLine || !endLine) {
		return { error: "Instance path, startLine, and endLine are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Delete script lines ${startLine}-${endLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (startLine < 1 || startLine > totalLines) error(`startLine out of range (1-${totalLines})`);
		if (endLine < startLine || endLine > totalLines) error(`endLine out of range (${startLine}-${totalLines})`);

		const resultLines: string[] = [];
		for (let i = 0; i < startLine - 1; i++) resultLines.push(lines[i]);
		for (let i = endLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		ScriptEditorService.UpdateSourceAsync(instance, () => newSource);

		return {
			success: true, instancePath,
			deletedLines: { startLine, endLine },
			linesDeleted: endLine - startLine + 1,
			newLineCount: resultLines.size(),
			message: "Script lines deleted successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to delete script lines: ${result}` };
}

function getAllScripts(requestData: Record<string, unknown>) {
	const includeSource = requestData.includeSource !== false;
	const results: Record<string, unknown>[] = [];

	const [success, err] = pcall(() => {
		for (const desc of game.GetDescendants()) {
			if (desc.IsA("LuaSourceContainer")) {
				const entry: Record<string, unknown> = {
					path: getInstancePath(desc),
					name: desc.Name,
					className: desc.ClassName,
				};
				if (includeSource) {
					const [ok, src] = pcall(() => (desc as unknown as { Source: string }).Source);
					entry.source = ok ? src : "[unreadable]";
				}
				results.push(entry);
			}
		}
	});

	if (!success) return { error: tostring(err) };
	return { count: results.size(), scripts: results };
}

function findReferences(requestData: Record<string, unknown>) {
	const query = requestData.query as string;
	if (!query) return { error: "query is required" };

	const results: Record<string, unknown>[] = [];
	const [success, err] = pcall(() => {
		for (const desc of game.GetDescendants()) {
			if (desc.IsA("LuaSourceContainer")) {
				const [ok, source] = pcall(() => (desc as unknown as { Source: string }).Source);
				if (ok && source) {
					if ((source as string).find(query, undefined, true)[0] !== undefined) {
						results.push({
							path: getInstancePath(desc),
							name: desc.Name,
							className: desc.ClassName,
						});
					}
				}
			}
		}
	});

	if (!success) return { error: tostring(err) };
	return { query, count: results.size(), references: results };
}

function executeLuauWait(requestData: Record<string, unknown>) {
	const code = requestData.code as string;
	if (!code) return { error: "code is required" };

	const wrappedCode = `return (function()\n${code}\nend)()`;
	const [fn, compileError] = loadstring(wrappedCode) as LuaTuple<[(() => unknown) | undefined, string | undefined]>;

	if (!fn) {
		return { error: `Syntax error: ${tostring(compileError)}` };
	}

	const [runOk, result] = pcall(fn);
	if (!runOk) return { error: `Runtime error: ${tostring(result)}` };

	// Attempt JSON serialization
	const HttpSvc = game.GetService("HttpService");
	const [serOk] = pcall(() => HttpSvc.JSONEncode(result));
	const finalResult = serOk ? result : tostring(result);

	return { success: true, result: finalResult };
}

export = {
	getScriptSource,
	setScriptSource,
	editScriptLines,
	insertScriptLines,
	deleteScriptLines,
	getAllScripts,
	findReferences,
	executeLuauWait,
};
