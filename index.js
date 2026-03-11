import { extension_settings, getContext } from '../../../../extensions.js';

/**
 * Fish Audio TTS Extension
 * Integrates natively with SillyTavern TTS API.
 */
const extensionName = 'fish-audio';
const extensionFolderPath = `scripts/extensions/tts/${extensionName}`;
const API_BASE = 'https://api.fish.audio';

// Ensure settings exist and merge with defaults
const defaultSettings = {
    apiKey: '',
    model: 's2-pro',
    format: 'mp3',
    latency: 'normal',
    voices: [], // List of { id, name, type: 'remote'|'instant', reference_id, audio, text }
    selectedVoiceId: '',
    manualReferenceId: ''
};

if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = { ...defaultSettings };
}

// Ensure voices array exists
if (!extension_settings[extensionName].voices) {
    extension_settings[extensionName].voices = [];
}

const settings = extension_settings[extensionName];

/**
 * Helper to display toastr messages if available in SillyTavern global scope
 */
function showAlerter(message, type = 'info') {
    if (typeof toastr !== 'undefined') {
        if (type === 'error') toastr.error(message, 'Fish Audio TTS');
        else if (type === 'success') toastr.success(message, 'Fish Audio TTS');
        else toastr.info(message, 'Fish Audio TTS');
    } else {
        console.log(`[Fish Audio TTS] ${type}: ${message}`);
    }
}

/**
 * Generate a unique ID
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Convert file to base64 string
 * @param {File} file 
 * @returns {Promise<string>}
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result;
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
}

/**
 * Perform TTS generation
 * @param {string} text 
 * @returns {Promise<string>} Blob URL of the generated audio
 */
async function generateAudio(text) {
    if (!settings.apiKey) {
        showAlerter('API Key is missing!', 'error');
        throw new Error('Fish Audio API Key is missing');
    }

    const payload = {
        text: text,
        model: settings.model || 's2-pro',
        format: settings.format || 'mp3',
        latency: settings.latency || 'normal'
    };

    // Voice Selection Logic
    let selectedVoice = null;
    if (settings.selectedVoiceId) {
        selectedVoice = settings.voices.find(v => v.id === settings.selectedVoiceId);
    }

    // Determine reference_id vs references array
    if (settings.manualReferenceId && settings.manualReferenceId.trim() !== '') {
        // Highest priority: manual override
        payload.reference_id = settings.manualReferenceId.trim();
    } else if (selectedVoice) {
        if (selectedVoice.type === 'remote' && selectedVoice.reference_id) {
            payload.reference_id = selectedVoice.reference_id;
        } else if (selectedVoice.type === 'instant' && selectedVoice.audio && selectedVoice.text) {
            payload.references = [
                {
                    audio: selectedVoice.audio,
                    text: selectedVoice.text
                }
            ];
        }
    }

    console.debug('[Fish Audio TTS] Payload:', payload);

    let retries = 3;
    let lastError = null;

    while (retries > 0) {
        try {
            const response = await fetch(`${API_BASE}/v1/tts`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${settings.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorDetails = '';
                try {
                    const errJson = await response.json();
                    errorDetails = JSON.stringify(errJson);
                } catch {
                    errorDetails = await response.text();
                }
                throw new Error(`API Error ${response.status}: ${errorDetails}`);
            }

            // Return blob url
            const blob = await response.blob();
            return URL.createObjectURL(blob);
            
        } catch (error) {
            lastError = error;
            console.warn(`[Fish Audio TTS] Generate failed. Retries left: ${retries - 1}`, error);
            retries--;
            if (retries > 0) {
                // Wait before retry
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    showAlerter('Failed to generate audio directly.', 'error');
    throw lastError;
}

/**
 * Creates a remote persistent model via Fish Audio API
 * @param {string} name 
 * @param {File} audioFile 
 * @param {string} transcript 
 * @returns {Promise<string>} reference_id
 */
async function createRemoteModel(name, audioFile, transcript) {
    if (!settings.apiKey) throw new Error('API Key missing');

    const formData = new FormData();
    formData.append('title', name); // typical api parameter
    // Fallback names for file/audio depending on exact API, typically 'audio' or 'file' and 'text'
    formData.append('audio', audioFile); 
    formData.append('text', transcript);

    const response = await fetch(`${API_BASE}/v1/voices`, { // standard /v1/voices or /model/create endpoint
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.apiKey}`
        },
        body: formData
    });

    if (!response.ok) {
        let errStr = await response.text();
        throw new Error(`Failed to create remote model: ${response.status} ${errStr}`);
    }

    const data = await response.json();
    return data.id || data.reference_id || data.voice_id; // Return the returned id
}

/**
 * Refresh local UI Select list for voices
 */
function populateLocalVoices() {
    const select = document.getElementById('fish_audio_current_voice');
    if (!select) return;

    // Reset keeping first element
    select.innerHTML = '<option value="">-- Random / Base Voice --</option>';

    settings.voices.forEach(v => {
        const option = document.createElement('option');
        option.value = v.id;
        option.textContent = `${v.name} (${v.type})`;
        if (v.id === settings.selectedVoiceId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

/**
 * Setup Settings UI Events
 */
function setupUI() {
    // Basic inputs
    $('#fish_audio_api_key').val(settings.apiKey).on('input', function () {
        settings.apiKey = $(this).val();
    });
    $('#fish_audio_model').val(settings.model).on('change', function () {
        settings.model = $(this).val();
    });
    $('#fish_audio_format').val(settings.format).on('change', function () {
        settings.format = $(this).val();
    });
    $('#fish_audio_latency').val(settings.latency).on('change', function () {
        settings.latency = $(this).val();
    });
    $('#fish_audio_reference_id').val(settings.manualReferenceId).on('input', function () {
        settings.manualReferenceId = $(this).val();
    });

    // Voices Select
    $('#fish_audio_current_voice').on('change', function () {
        settings.selectedVoiceId = $(this).val();
    });

    // Populate Select
    populateLocalVoices();

    // Voice Clone Logic
    $('#fish_audio_save_voice_btn').on('click', async function () {
        const name = $('#fish_audio_clone_name').val().trim();
        const transcript = $('#fish_audio_clone_transcript').val().trim();
        const mode = $('#fish_audio_clone_mode').val();
        const fileInput = document.getElementById('fish_audio_clone_file');
        
        if (!name) return showAlerter('Voice Name is required', 'error');
        if (!fileInput.files || fileInput.files.length === 0) return showAlerter('Please select an audio file sample.', 'error');
        
        const file = fileInput.files[0];
        const $btn = $(this);
        $btn.prop('disabled', true).text('Processing...');

        try {
            if (mode === 'instant') {
                if (!transcript) {
                    throw new Error('Transcript is required for Instant Clone.');
                }
                const base64Audio = await fileToBase64(file);
                if (base64Audio.length > 5 * 1024 * 1024) { // Roughly 5MB limit for base64 saving in local storage logic
                    showAlerter('Audio file is very large. Consider Remote Model creation or cut it to 5-10 seconds.', 'info');
                }

                settings.voices.push({
                    id: generateId(),
                    name: name,
                    type: 'instant',
                    reference_id: null,
                    audio: base64Audio,
                    text: transcript
                });
                
                showAlerter(`Voice "${name}" saved instantly to local storage!`, 'success');

            } else {
                showAlerter('Uploading model to Fish Audio API...', 'info');
                // Remote Create
                const refId = await createRemoteModel(name, file, transcript);
                settings.voices.push({
                    id: generateId(),
                    name: name,
                    type: 'remote',
                    reference_id: refId,
                    audio: null,
                    text: null
                });
                showAlerter(`Model "${name}" created remotely!`, 'success');
            }

            // Cleanup fields
            $('#fish_audio_clone_name').val('');
            $('#fish_audio_clone_transcript').val('');
            fileInput.value = '';

            // Update UI
            populateLocalVoices();
            console.log('[Fish Audio TTS] Voices:', settings.voices);
            getContext().saveSettings();

        } catch (err) {
            console.error('[Fish Audio TTS] Voice Creation Error:', err);
            showAlerter(err.message || 'Failed to add voice', 'error');
        } finally {
            $btn.prop('disabled', false).html('<i class="fa-solid fa-save"></i> Add Voice');
        }
    });

    // Test Voice Logic
    $('#fish_audio_test_btn').on('click', async function () {
        const textToTest = $('#fish_audio_test_text').val().trim();
        if (!textToTest) return showAlerter('Enter some text to test', 'info');

        $('#fish_audio_test_btn').hide();
        $('#fish_audio_loading').show();
        $('#fish_audio_test_playback').hide();

        try {
            const audioUrl = await generateAudio(textToTest);
            const player = document.getElementById('fish_audio_player');
            player.src = audioUrl;
            $('#fish_audio_test_playback').show();
            player.play();
        } catch (err) {
            console.error(err);
            showAlerter('Test Failed: ' + err.message, 'error');
        } finally {
            $('#fish_audio_test_btn').show();
            $('#fish_audio_loading').hide();
        }
    });
}

/**
 * Register the provider with SillyTavern global instances natively if possible,
 * else push to the TTS providers array.
 */
function registerProvider() {
    const providerDef = {
        name: 'Fish Audio',
        settingsHtml: '', // Normally we might inject settings via standard DOM insertion (below)
        onSettingsChange: () => {},
        generate: async (text, voiceInfo) => {
            // voiceInfo might contain selected voice from character card mapping in standard ST TTS
            // In a simple generic setup, relying on our UI's voice is sufficient or matching VoiceInfo
            // To make it fully native, you could map character name to settings.voices
            return await generateAudio(text);
        }
    };

    if (window.SillyTavern && window.SillyTavern.registerTTSProvider) {
        window.SillyTavern.registerTTSProvider(extensionName, providerDef);
    } else {
        // Just log that we successfully loaded.
        console.log('[Fish Audio TTS] Loaded custom TTS module. Used in native DOM');
    }
}

jQuery(async () => {
    // 1. Fetch settings HTML
    const settingsHtmlPath = `${extensionFolderPath}/settings.html`;
    try {
        const html = await $.get(settingsHtmlPath);
        
        // Append settings UI to standard TTS extension settings area
        if ($('#tts_settings').length) {
            $('#tts_settings').append(html);
        } else {
            // Fallback for custom layouts
            $('#extensions_settings').append(html); 
        }

        // Setup UI handlers
        setupUI();

        // Register natively
        registerProvider();
        
        console.log(`[Fish Audio TTS] Loaded Extension ✓`);
    } catch (e) {
        console.error(`[Fish Audio TTS] Failed to load settings template:`, e);
    }
});
