import { extension_settings, getContext } from '../../../../extensions.js';

const extensionName = 'fish-audio';
const extensionFolderPath = `scripts/extensions/tts/${extensionName}`;
const API_BASE = 'https://api.fish.audio';

const defaultSettings = {
    apiKey: '',
    model: 's2-pro',
    format: 'mp3',
    latency: 'normal',
    voices: [], // { id, name, type: 'remote'|'instant', reference_id, audio, text }
    selectedVoiceId: '',
    manualReferenceId: ''
};

if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = { ...defaultSettings };
}
if (!extension_settings[extensionName].voices) {
    extension_settings[extensionName].voices = [];
}
const settings = extension_settings[extensionName];

function showAlerter(message, type = 'info') {
    if (typeof toastr !== 'undefined') {
        if (type === 'error') toastr.error(message, 'Fish Audio TTS');
        else if (type === 'success') toastr.success(message, 'Fish Audio TTS');
        else toastr.info(message, 'Fish Audio TTS');
    } else {
        console.log(`[Fish Audio TTS] ${type}: ${message}`);
    }
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

function getVoiceInfo() {
    let selectedVoice = settings.selectedVoiceId ? settings.voices.find(v => v.id === settings.selectedVoiceId) : null;
    let payload = {};
    if (settings.manualReferenceId && settings.manualReferenceId.trim() !== '') {
        payload.reference_id = settings.manualReferenceId.trim();
    } else if (selectedVoice) {
        if (selectedVoice.type === 'remote' && selectedVoice.reference_id) {
            payload.reference_id = selectedVoice.reference_id;
        } else if (selectedVoice.type === 'instant' && selectedVoice.audio && selectedVoice.text) {
            payload.references = [{ audio: selectedVoice.audio, text: selectedVoice.text }];
        }
    }
    return payload;
}

async function generateAudio(text) {
    if (!settings.apiKey) {
        showAlerter('API Key is missing!', 'error');
        throw new Error('Fish Audio API Key is missing');
    }

    const payload = {
        text: text,
        model: settings.model || 's2-pro',
        format: settings.format || 'mp3',
        latency: settings.latency || 'normal',
        ...getVoiceInfo()
    };

    let retries = 3;
    let lastError = null;

    while (retries > 0) {
        try {
            const response = await fetch(`${API_BASE}/v1/tts`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errJson = await response.text();
                throw new Error(`API Error ${response.status}: ${errJson}`);
            }

            const blob = await response.blob();
            return URL.createObjectURL(blob);
        } catch (error) {
            lastError = error;
            console.warn(`[Fish Audio] Generate failed. Retries left: ${retries - 1}`, error);
            retries--;
            if (retries > 0) await new Promise(r => setTimeout(r, 1000));
        }
    }
    showAlerter('Failed to generate audio.', 'error');
    throw lastError;
}

async function createRemoteModel(name, audioFile, transcript) {
    if (!settings.apiKey) throw new Error('API Key missing');
    const formData = new FormData();
    formData.append('title', name);
    formData.append('audio', audioFile); 
    formData.append('text', transcript);

    const response = await fetch(`${API_BASE}/v1/voices`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${settings.apiKey}` },
        body: formData
    });

    if (!response.ok) {
        let errStr = await response.text();
        throw new Error(`Failed to create remote model: ${response.status} ${errStr}`);
    }

    const data = await response.json();
    return data.id || data.reference_id || data.voice_id; 
}

function populateLocalVoices() {
    const select = document.getElementById('fish_audio_current_voice');
    if (!select) return;
    
    const currentVal = settings.selectedVoiceId || select.value;
    select.innerHTML = '<option value="">-- Random / Base Voice --</option>';
    
    settings.voices.forEach(v => {
        const option = document.createElement('option');
        option.value = v.id;
        option.textContent = `${v.name} (${v.type})`;
        if (v.id === settings.selectedVoiceId) option.selected = true;
        select.appendChild(option);
    });
    select.value = currentVal;
    settings.selectedVoiceId = currentVal;
}

function restoreUIVariables() {
    $('#fish_audio_api_key').val(settings.apiKey);
    $('#fish_audio_model').val(settings.model);
    $('#fish_audio_format').val(settings.format);
    $('#fish_audio_latency').val(settings.latency);
    $('#fish_audio_reference_id').val(settings.manualReferenceId);
    populateLocalVoices();
}

function setupUIEventDelegations() {
    // Basic inputs
    $(document).on('input', '#fish_audio_api_key', function() { settings.apiKey = $(this).val(); getContext().saveSettings(); });
    $(document).on('change', '#fish_audio_model', function() { settings.model = $(this).val(); getContext().saveSettings(); });
    $(document).on('change', '#fish_audio_format', function() { settings.format = $(this).val(); getContext().saveSettings(); });
    $(document).on('change', '#fish_audio_latency', function() { settings.latency = $(this).val(); getContext().saveSettings(); });
    $(document).on('input', '#fish_audio_reference_id', function() { settings.manualReferenceId = $(this).val(); getContext().saveSettings(); });
    $(document).on('change', '#fish_audio_current_voice', function() { settings.selectedVoiceId = $(this).val(); getContext().saveSettings(); });

    // Save/Clone Voice
    $(document).on('click', '#fish_audio_save_voice_btn', async function () {
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
                if (!transcript) throw new Error('Transcript is required for Instant Clone.');
                const base64Audio = await fileToBase64(file);
                settings.voices.push({
                    id: generateId(), name: name, type: 'instant', reference_id: null, audio: base64Audio, text: transcript
                });
                showAlerter(`Voice "${name}" saved instantly!`, 'success');
            } else {
                showAlerter('Uploading model to Fish Audio...', 'info');
                const refId = await createRemoteModel(name, file, transcript);
                settings.voices.push({
                    id: generateId(), name: name, type: 'remote', reference_id: refId, audio: null, text: null
                });
                showAlerter(`Model "${name}" created remotely!`, 'success');
            }

            $('#fish_audio_clone_name').val('');
            $('#fish_audio_clone_transcript').val('');
            fileInput.value = '';
            populateLocalVoices();
            getContext().saveSettings();
        } catch (err) {
            console.error(err);
            showAlerter(err.message, 'error');
        } finally {
            $btn.prop('disabled', false).html('<i class="fa-solid fa-save"></i> Add Voice');
        }
    });

    // Test Voice
    $(document).on('click', '#fish_audio_test_btn', async function () {
        const textToTest = $('#fish_audio_test_text').val().trim();
        if (!textToTest) return;

        const $btn = $(this);
        $btn.hide();
        $('#fish_audio_loading').show();
        $('#fish_audio_test_playback').hide();

        try {
            const audioUrl = await generateAudio(textToTest);
            const player = document.getElementById('fish_audio_player');
            player.src = audioUrl;
            $('#fish_audio_test_playback').show();
            player.play();
        } catch (err) {
            showAlerter('Test Failed: ' + err.message, 'error');
        } finally {
            $btn.show();
            $('#fish_audio_loading').hide();
        }
    });

    // Since ST TTS menus dynamically re-render, we watch for our settings block entering the DOM 
    // and immediately re-populate it with the saved settings state.
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && (node.id === 'fish-audio-settings' || node.querySelector('#fish-audio-settings'))) {
                        restoreUIVariables();
                    }
                });
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function registerProvider(html) {
    const providerDef = {
        name: 'Fish Audio', // This is what shows up in the TTS Providers Dropdown
        settingsHtml: html, // The HTML ST renders when the provider is selected
        onSettingsChange: () => {},
        generate: async (text, voiceInfo) => { 
            // voiceInfo sometimes passed by ST's automatic Voice Map
            return await generateAudio(text); 
        }
    };

    let registered = false;

    // Standard native method for SillyTavern TTS registration
    if (typeof SillyTavern !== 'undefined' && SillyTavern.registerTTSProvider) {
        SillyTavern.registerTTSProvider(extensionName, providerDef);
        registered = true;
    } else if (window.SillyTavern && window.SillyTavern.registerTTSProvider) {
        window.SillyTavern.registerTTSProvider(extensionName, providerDef);
        registered = true;
    } else if (typeof window.registerTTSProvider !== 'undefined') {
        window.registerTTSProvider(extensionName, providerDef);
        registered = true;
    }

    if (!registered) {
        console.warn('[Fish Audio TTS] Could not find native registerTTSProvider functions. Falling back to manual HTML injection.');
        if ($('#tts_settings').length) {
            $('#tts_settings').append(html);
        } else {
            $('#extensions_settings').append(html);
        }
        restoreUIVariables();
    } else {
        console.log('[Fish Audio TTS] successfully registered via native SillyTavern.registerTTSProvider.');
    }
}

jQuery(async () => {
    const settingsHtmlPath = `${extensionFolderPath}/settings.html`;
    try {
        const html = await $.get(settingsHtmlPath);
        setupUIEventDelegations();
        registerProvider(html);
    } catch (e) {
        console.error(`[Fish Audio TTS] Failed to load settings:`, e);
    }
});
