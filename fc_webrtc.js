window.familyChat.webrtc = {
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    isCallActive: false,
    callTimer: null,
    callStartTime: null,
    currentCallWith: null,

    init: function() {
        this.setupEventListeners();
        this.checkWebRTCSupport();
    },

    setupEventListeners: function() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('call-btn')) {
                this.startCall(e.target.dataset.username);
            }
            if (e.target.classList.contains('accept-call')) {
                this.acceptCall();
            }
            if (e.target.classList.contains('reject-call')) {
                this.rejectCall();
            }
            if (e.target.classList.contains('end-call')) {
                this.endCall();
            }
            if (e.target.classList.contains('toggle-mic')) {
                this.toggleMicrophone();
            }
        });
    },

    checkWebRTCSupport: function() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showError('Голосовые звонки не доступны в вашем браузере');
            return false;
        }
        return true;
    },

    startCall: async function(username) {
        if (!this.checkWebRTCSupport()) return;
        
        try {
            this.currentCallWith = username;
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: true,
                video: false 
            });
            
            this.createPeerConnection();
            this.addLocalStream();
            
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            familyChat.ws.send(JSON.stringify({
                type: 'call_offer',
                target: username,
                offer: offer
            }));
            
            this.showCallInterface('calling');
            
        } catch (error) {
            console.error('Ошибка начала звонка:', error);
            this.showError('Не удалось начать звонок');
        }
    },

    createPeerConnection: function() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(configuration);
        
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                familyChat.ws.send(JSON.stringify({
                    type: 'ice_candidate',
                    target: this.currentCallWith,
                    candidate: event.candidate
                }));
            }
        };
        
        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            this.setupRemoteAudio();
        };
        
        this.peerConnection.onconnectionstatechange = () => {
            switch(this.peerConnection.connectionState) {
                case 'connected':
                    this.callConnected();
                    break;
                case 'disconnected':
                case 'failed':
                    this.callEnded();
                    break;
            }
        };
    },

    addLocalStream: function() {
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });
    },

    setupRemoteAudio: function() {
        const audioElement = document.getElementById('remoteAudio');
        audioElement.srcObject = this.remoteStream;
        audioElement.play().catch(e => console.error('Audio play error:', e));
    },

    handleOffer: async function(data) {
        if (!this.checkWebRTCSupport()) return;
        
        if (this.isCallActive) {
            familyChat.ws.send(JSON.stringify({
                type: 'call_busy',
                target: data.from
            }));
            return;
        }
        
        this.currentCallWith = data.from;
        this.showIncomingCall(data.from);
    },

    handleAnswer: async function(data) {
        await this.peerConnection.setRemoteDescription(data.answer);
    },

    handleIceCandidate: async function(data) {
        try {
            await this.peerConnection.addIceCandidate(data.candidate);
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    },

    acceptCall: async function() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: true,
                video: false 
            });
            
            this.createPeerConnection();
            this.addLocalStream();
            
            await this.peerConnection.setRemoteDescription(this.pendingOffer);
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            familyChat.ws.send(JSON.stringify({
                type: 'call_answer',
                target: this.currentCallWith,
                answer: answer
            }));
            
            this.showCallInterface('active');
            this.hideIncomingCall();
            
        } catch (error) {
            console.error('Ошибка принятия звонка:', error);
            this.showError('Не удалось принять звонок');
        }
    },

    rejectCall: function() {
        familyChat.ws.send(JSON.stringify({
            type: 'call_reject',
            target: this.currentCallWith
        }));
        this.hideIncomingCall();
        this.cleanupCall();
    },

    endCall: function() {
        familyChat.ws.send(JSON.stringify({
            type: 'call_end',
            target: this.currentCallWith
        }));
        this.callEnded();
    },

    callConnected: function() {
        this.isCallActive = true;
        this.callStartTime = Date.now();
        this.startCallTimer();
        this.showCallInterface('active');
    },

    callEnded: function() {
        this.isCallActive = false;
        this.stopCallTimer();
        this.hideCallInterface();
        this.cleanupCall();
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
    },

    cleanupCall: function() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.localStream = null;
        this.remoteStream = null;
        this.currentCallWith = null;
    },

    toggleMicrophone: function() {
        if (this.localStream) {
            const audioTracks = this.localStream.getAudioTracks();
            audioTracks.forEach(track => {
                track.enabled = !track.enabled;
            });
        }
    },

    startCallTimer: function() {
        this.callTimer = setInterval(() => {
            const elapsed = Date.now() - this.callStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            document.getElementById('callTimer').textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);
    },

    stopCallTimer: function() {
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
    },

    showIncomingCall: function(from) {
        const modal = document.getElementById('incomingCallModal');
        modal.querySelector('.caller-name').textContent = from;
        modal.style.display = 'block';
    },

    hideIncomingCall: function() {
        document.getElementById('incomingCallModal').style.display = 'none';
    },

    showCallInterface: function(state) {
        const interface = document.getElementById('callInterface');
        interface.style.display = 'block';
        
        if (state === 'calling') {
            interface.querySelector('.call-status').textContent = 'Вызов...';
        } else if (state === 'active') {
            interface.querySelector('.call-status').textContent = 'Разговор';
        }
    },

    hideCallInterface: function() {
        document.getElementById('callInterface').style.display = 'none';
    },

    showError: function(message) {
        alert(message);
    }
};

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    familyChat.webrtc.init();
});