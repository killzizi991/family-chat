window.familyChat = window.familyChat || {};

(function() {
    familyChat.webrtc = {
        peerConnection: null,
        localStream: null,
        remoteStream: null,
        isCaller: false,
        callInProgress: false,
        currentCallRecipient: null,

        init: function() {
            this.setupEventListeners();
        },

        setupEventListeners: function() {
            document.addEventListener('click', (e) => {
                if (e.target.id === 'fc_startCall') {
                    this.startCall();
                } else if (e.target.id === 'fc_endCall') {
                    this.endCall();
                } else if (e.target.id === 'fc_acceptCall') {
                    this.acceptCall();
                } else if (e.target.id === 'fc_declineCall') {
                    this.declineCall();
                }
            });
        },

        startCall: function() {
            if (!familyChat.currentChat.recipient) return;
            
            this.isCaller = true;
            this.currentCallRecipient = familyChat.currentChat.recipient;
            this.showCallInterface('calling');
            
            this.initializePeerConnection();
            this.getUserMedia()
                .then(() => this.createOffer())
                .catch(error => {
                    console.error('Ошибка начала звонка:', error);
                    this.endCall();
                });
        },

        acceptCall: function() {
            this.isCaller = false;
            this.callInProgress = true;
            this.showCallInterface('active');
            
            this.initializePeerConnection();
            this.getUserMedia()
                .then(() => this.createAnswer())
                .catch(error => {
                    console.error('Ошибка принятия звонка:', error);
                    this.endCall();
                });
        },

        declineCall: function() {
            this.sendWebRTCMessage('webrtc_end_call', {});
            this.hideCallInterface();
            this.cleanup();
        },

        endCall: function() {
            this.sendWebRTCMessage('webrtc_end_call', {});
            this.hideCallInterface();
            this.cleanup();
        },

        initializePeerConnection: function() {
            const configuration = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            };

            this.peerConnection = new RTCPeerConnection(configuration);

            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendWebRTCMessage('webrtc_candidate', event.candidate);
                }
            };

            this.peerConnection.ontrack = (event) => {
                this.remoteStream = event.streams[0];
                this.setupRemoteAudio();
            };

            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
        },

        getUserMedia: function() {
            return navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => {
                    this.localStream = stream;
                    this.setupLocalAudio();
                    return stream;
                });
        },

        createOffer: function() {
            return this.peerConnection.createOffer()
                .then(offer => this.peerConnection.setLocalDescription(offer))
                .then(() => {
                    this.sendWebRTCMessage('webrtc_offer', this.peerConnection.localDescription);
                });
        },

        createAnswer: function() {
            return this.peerConnection.createAnswer()
                .then(answer => this.peerConnection.setLocalDescription(answer))
                .then(() => {
                    this.sendWebRTCMessage('webrtc_answer', this.peerConnection.localDescription);
                });
        },

        handleOffer: function(offer, sender) {
            if (this.callInProgress) return;

            this.isCaller = false;
            this.currentCallRecipient = sender;
            this.showIncomingCallInterface();
            
            this.initializePeerConnection();
            this.peerConnection.setRemoteDescription(offer)
                .catch(error => console.error('Ошибка установки offer:', error));
        },

        handleAnswer: function(answer) {
            this.peerConnection.setRemoteDescription(answer)
                .catch(error => console.error('Ошибка установки answer:', error));
        },

        handleCandidate: function(candidate) {
            this.peerConnection.addIceCandidate(candidate)
                .catch(error => console.error('Ошибка добавления candidate:', error));
        },

        handleEndCall: function() {
            if (this.callInProgress) {
                this.showCallEndedNotification();
            }
            this.hideCallInterface();
            this.cleanup();
        },

        sendWebRTCMessage: function(type, data) {
            if (familyChat.ws && familyChat.ws.readyState === WebSocket.OPEN) {
                familyChat.ws.send(JSON.stringify({
                    type: type,
                    recipient: this.currentCallRecipient,
                    data: data
                }));
            }
        },

        setupLocalAudio: function() {
            const localAudio = document.getElementById('fc_localAudio');
            if (localAudio) {
                localAudio.srcObject = this.localStream;
                localAudio.volume = 0.5;
            }
        },

        setupRemoteAudio: function() {
            const remoteAudio = document.getElementById('fc_remoteAudio');
            if (remoteAudio && this.remoteStream) {
                remoteAudio.srcObject = this.remoteStream;
            }
        },

        showCallInterface: function(state) {
            this.hideAllCallInterfaces();
            
            const callContainer = document.getElementById('fc_callContainer');
            if (!callContainer) return;

            callContainer.style.display = 'block';
            
            if (state === 'calling') {
                document.getElementById('fc_callStatus').textContent = 'Звонок...';
                document.getElementById('fc_callControls').style.display = 'block';
                document.getElementById('fc_incomingCall').style.display = 'none';
                this.callInProgress = true;
            } else if (state === 'active') {
                document.getElementById('fc_callStatus').textContent = 'Разговор';
                document.getElementById('fc_callControls').style.display = 'block';
                document.getElementById('fc_incomingCall').style.display = 'none';
                this.callInProgress = true;
            }
            if (familyChat.ui && familyChat.ui.updateCallButton) {
                familyChat.ui.updateCallButton();
            }
        },

        showIncomingCallInterface: function() {
            this.hideAllCallInterfaces();
            
            const callContainer = document.getElementById('fc_callContainer');
            if (!callContainer) return;

            callContainer.style.display = 'block';
            document.getElementById('fc_incomingCall').style.display = 'block';
            document.getElementById('fc_callControls').style.display = 'none';
            document.getElementById('fc_callStatus').textContent = 'Входящий звонок';
        },

        hideCallInterface: function() {
            const callContainer = document.getElementById('fc_callContainer');
            if (callContainer) {
                callContainer.style.display = 'none';
            }
            this.hideAllCallInterfaces();
        },

        hideAllCallInterfaces: function() {
            const elements = [
                'fc_callControls',
                'fc_incomingCall'
            ];
            
            elements.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        },

        showCallEndedNotification: function() {
            const notification = document.createElement('div');
            notification.className = 'call-notification';
            notification.textContent = 'Звонок завершен';
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #333;
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                z-index: 10000;
            `;
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.remove();
            }, 3000);
        },

        cleanup: function() {
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }
            
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
            
            this.remoteStream = null;
            this.callInProgress = false;
            this.currentCallRecipient = null;
            
            const localAudio = document.getElementById('fc_localAudio');
            const remoteAudio = document.getElementById('fc_remoteAudio');
            if (localAudio) localAudio.srcObject = null;
            if (remoteAudio) remoteAudio.srcObject = null;
            
            if (familyChat.ui && familyChat.ui.updateCallButton) {
                familyChat.ui.updateCallButton();
            }
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        familyChat.webrtc.init();
    });
})();