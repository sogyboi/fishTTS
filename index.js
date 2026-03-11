/**
 * Fish Audio TTS Extension for SillyTavern
 * Provides TTS via Fish Audio API with instant voice cloning and persistent voice models.
 */

import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "fishTTS";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// ── Default Settings ──────────────────────────────────────────────────
const defaultSettings = Object.freeze({
    apiKey: '',
    model: 's2-pro',
    format: 'mp3',
    latency: 'normal',
    voices: [],           // { id, name, type:'remote'|'instant', reference_id, audio, text }
    selectedVoiceId: '',
    manualReferenceId: '',
});

// ── Ensure settings exist ─────────────────────────────────────────────
function getSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extension_settings[extensionName], key)) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }
    return extension_settings[extensionName];
}

const settings = getSettings();

const API_BASE = 'https://api.fish.audio';

// ── Helpers ───────────────────────────────────────────────────────────

function showAlert(message, type = 'info') {
    if (typeof toastr !== 'undefined') {
        toastr[type] ? toastr[type](message, 'Fish Audio TTS') : toastr.info(message, 'Fish Audio TTS');
    }
    console.log(`[Fish Audio TTS] ${type}: ${message}`);
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
    });
}

// ── Voice Info Builder ────────────────────────────────────────────────

function getVoicePayload() {
    const payload = {};
    if (settings.manualReferenceId && settings.manualReferenceId.trim() !== '') {
        payload.reference_id = settings.manualReferenceId.trim();
    } else if (settings.selectedVoiceId) {
        const voice = settings.voices.find(v => v.id === settings.selectedVoiceId);
        if (voice) {
            if (voice.type === 'remote' && voice.reference_id) {
                payload.reference_id = voice.reference_id;
            } else if (voice.type === 'instant' && voice.audio && voice.text) {
                payload.references = [{ audio: voice.audio, text: voice.text }];
            }
        }
    }
    return payload;
}

// ── TTS Generation ────────────────────────────────────────────────────

async function generateAudio(text) {
    if (!settings.apiKey) {
        showAlert('API Key is missing! Set it in the Fish Audio TTS settings.', 'error');
        throw new Error('Fish Audio API Key is missing');
    }

    const body = {
        text,
        model: settings.model || 's2-pro',
        format: settings.format || 'mp3',
        latency: settings.latency || 'normal',
        ...getVoicePayload(),
    };

    console.debug('[Fish Audio TTS] Request body:', body);

    let retries = 3;
    let lastError;

    while (retries > 0) {
        try {
            const res = await fetch(`${API_BASE}/v1/tts`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${settings.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API ${res.status}: ${errText}`);
            }

            const blob = await res.blob();
            return URL.createObjectURL(blob);
        } catch (err) {
            lastError = err;
            retries--;
            console.warn(`[Fish Audio TTS] Attempt failed, ${retries} retries left`, err);
            if (retries > 0) await new Promise(r => setTimeout(r, 1000));
        }
    }

    showAlert('TTS generation failed after retries.', 'error');
    throw lastError;
}

// ── Remote Model Creation ─────────────────────────────────────────────

async function createRemoteModel(name, audioFile, transcript) {
    if (!settings.apiKey) throw new Error('API Key missing');

    const fd = new FormData();
    fd.append('title', name);
    fd.append('audio', audioFile);
    fd.append('text', transcript);

    const res = await fetch(`${API_BASE}/v1/voices`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${settings.apiKey}` },
        body: fd,
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Create model failed ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.id || data.reference_id || data.voice_id;
}

// ── UI Helpers ────────────────────────────────────────────────────────

function populateVoiceSelect() {
    const el = document.getElementById('fish_audio_current_voice');
    if (!el) return;

    el.innerHTML = '<option value="">-- Default / No Clone --</option>';
    for (const v of settings.voices) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = `${v.name} (${v.type})`;
        if (v.id === settings.selectedVoiceId) opt.selected = true;
        el.appendChild(opt);
    }
}

function restoreUI() {
    $('#fish_audio_api_key').val(settings.apiKey);
    $('#fish_audio_model').val(settings.model);
    $('#fish_audio_format').val(settings.format);
    $('#fish_audio_latency').val(settings.latency);
    $('#fish_audio_reference_id').val(settings.manualReferenceId);
    populateVoiceSelect();
}

// ── Boot ──────────────────────────────────────────────────────────────

jQuery(async () => {
    // 1. Load the settings HTML template
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);

    // 2. Append it to the extensions settings panel (left column)
    $('#extensions_settings').append(settingsHtml);

    // 3. Restore saved values into the UI
    restoreUI();

    // 4. Bind events ──────────────────────────────────────────────────

    // API Key
    $('#fish_audio_api_key').on('input', function () {
        settings.apiKey = $(this).val();
        saveSettingsDebounced();
    });

    // Model selector
    $('#fish_audio_model').on('change', function () {
        settings.model = $(this).val();
        saveSettingsDebounced();
    });

    // Format selector
    $('#fish_audio_format').on('change', function () {
        settings.format = $(this).val();
        saveSettingsDebounced();
    });

    // Latency selector
    $('#fish_audio_latency').on('change', function () {
        settings.latency = $(this).val();
        saveSettingsDebounced();
    });

    // Manual reference ID
    $('#fish_audio_reference_id').on('input', function () {
        settings.manualReferenceId = $(this).val();
        saveSettingsDebounced();
    });

    // Voice dropdown
    $('#fish_audio_current_voice').on('change', function () {
        settings.selectedVoiceId = $(this).val();
        saveSettingsDebounced();
    });

    // ── Clone / Add Voice ────────────────────────────────────────────
    $('#fish_audio_save_voice_btn').on('click', async function () {
        const name = $('#fish_audio_clone_name').val().trim();
        const transcript = $('#fish_audio_clone_transcript').val().trim();
        const mode = $('#fish_audio_clone_mode').val();
        const fileInput = document.getElementById('fish_audio_clone_file');

        if (!name) return showAlert('Voice Name is required.', 'error');
        if (!fileInput.files?.length) return showAlert('Select an audio file.', 'error');

        const file = fileInput.files[0];
        const $btn = $(this);
        $btn.prop('disabled', true).text(' Processing...');

        try {
            if (mode === 'instant') {
                if (!transcript) throw new Error('Transcript is required for Instant Clone.');
                const b64 = await fileToBase64(file);
                settings.voices.push({
                    id: generateId(), name, type: 'instant',
                    reference_id: null, audio: b64, text: transcript,
                });
                showAlert(`"${name}" saved as instant clone!`, 'success');
            } else {
                showAlert('Uploading to Fish Audio API...', 'info');
                const refId = await createRemoteModel(name, file, transcript);
                settings.voices.push({
                    id: generateId(), name, type: 'remote',
                    reference_id: refId, audio: null, text: null,
                });
                showAlert(`"${name}" created as remote model!`, 'success');
            }

            // Clear input fields
            $('#fish_audio_clone_name').val('');
            $('#fish_audio_clone_transcript').val('');
            fileInput.value = '';

            populateVoiceSelect();
            saveSettingsDebounced();
        } catch (err) {
            console.error('[Fish Audio TTS]', err);
            showAlert(err.message, 'error');
        } finally {
            $btn.prop('disabled', false).html('<i class="fa-solid fa-save"></i> Add Voice');
        }
    });

    // ── Test Voice ───────────────────────────────────────────────────
    $('#fish_audio_test_btn').on('click', async function () {
        const text = $('#fish_audio_test_text').val().trim();
        if (!text) return showAlert('Enter test text first.', 'info');

        const $btn = $(this);
        $btn.hide();
        $('#fish_audio_loading').show();
        $('#fish_audio_test_playback').hide();

        try {
            const url = await generateAudio(text);
            const player = document.getElementById('fish_audio_player');
            player.src = url;
            $('#fish_audio_test_playback').show();
            player.play();
        } catch (err) {
            showAlert('Test failed: ' + err.message, 'error');
        } finally {
            $btn.show();
            $('#fish_audio_loading').hide();
        }
    });

    console.log('[Fish Audio TTS] Extension loaded ✓');
});
