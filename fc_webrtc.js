window.familyChat = window.familyChat || {};

(function() {
    familyChat.webrtc = {
        peerConnection: null,
        localStream: null,
        remoteStream: null,
        isCallActive: false,
        currentCallTarget: null,
        isInitiator: false,

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
                } else if (e.target.id === 'fc_rejectCall') {
                    this.rejectCall();
                }
            });
        },

        startCall: async function() {
            if (!familyChat.currentChat.recipient) {
                alert('Выберите пользователя для звонка');
                return;
            }

            try {
                this.currentCallTarget = familyChat.currentChat.recipient;
                this.isInitiator = true;
                
                await this.getUserMedia();
                this.createPeerConnection();
                
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                
                familyChat.ws.send(JSON.stringify({
                    type: 'webrtc_offer',
                    offer: offer,
                    targetUser: this.currentCallTarget
                }));
                
                this.showCallInterface('calling');
            } catch (error) {
                console.error('Ошибка начала звонка:', error);
                alert('Ошибка начала звонка');
            }
        },

        acceptCall: async function() {
            try {
                await this.getUserMedia();
                this.createPeerConnection();
                
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(this.incomingOffer)
                );
                
                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);
                
                familyChat.ws.send(JSON.stringify({
                    type: 'webrtc_answer',
                    answer: answer,
                    targetUser: this.incomingCallFrom
                }));
                
                this.showCallInterface('active');
                this.isCallActive = true;
            } catch (error) {
                console.error('Ошибка принятия звонка:', error);
                alert('Ошибка принятия звонка');
            }
        },

        rejectCall: function() {
            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_call_end',
                targetUser: this.incomingCallFrom
            }));
            
            this.hideCallInterface();
            this.incomingOffer = null;
            this.incomingCallFrom = null;
        },

        endCall: function() {
            if (this.isCallActive) {
                familyChat.ws.send(JSON.stringify({
                    type: 'webrtc_call_end',
                    targetUser: this.currentCallTarget
                }));
            }
            
            this.cleanupCall();
            this.hideCallInterface();
        },

        handleOffer: async function(offer, from) {
            this.incomingOffer = offer;
            this.incomingCallFrom = from;
            this.currentCallTarget = from;
            
            this.showIncomingCallInterface();
        },

        handleAnswer: async function(answer) {
            if (this.peerConnection) {
                await this.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(answer)
                );
                this.isCallActive = true;
                this.showCallInterface('active');
            }
        },

        handleIceCandidate: function(candidate) {
            if (this.peerConnection) {
                this.peerConnection.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );
            }
        },

        handleCallEnd: function() {
            this.cleanupCall();
            this.hideCallInterface();
            alert('Звонок завершен');
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
                        type: 'webrtc_ice_candidate',
                        candidate: event.candidate,
                        targetUser: this.currentCallTarget
                    }));
                }
            };
            
            this.peerConnection.ontrack = (event) => {
                this.remoteStream = event.streams[0];
                this.updateRemoteVideo();
            };
            
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
        },

        getUserMedia: async function() {
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
                this.updateLocalVideo();
            } catch (error) {
                console.error('Ошибка доступа к медиаустройствам:', error);
                throw error;
            }
        },

        updateLocalVideo: function() {
            const localVideo = document.getElementById('fc_localVideo');
            if (localVideo && this.localStream) {
                localVideo.srcObject = this.localStream;
            }
        },

        updateRemoteVideo: function() {
            const remoteVideo = document.getElementById('fc_remoteVideo');
            if (remoteVideo && this.remoteStream) {
                remoteVideo.srcObject = this.remoteStream;
            }
        },

        showCallInterface: function(state) {
            const callContainer = document.getElementById('fc_callContainer');
            const callStatus = document.getElementById('fc_callStatus');
            
            callContainer.style.display = 'block';
            
            switch (state) {
                case 'calling':
                    callStatus.textContent = `Звонок пользователю ${this.currentCallTarget}...`;
                    document.getElementById('fc_callControls').style.display = 'block';
                    document.getElementById('fc_incomingCall').style.display = 'none';
                    break;
                case 'active':
                    callStatus.textContent = `Разговор с ${this.currentCallTarget}`;
                    document.getElementById('fc_callControls').style.display = 'block';
                    document.getElementById('fc_incomingCall').style.display = 'none';
                    break;
            }
        },

        showIncomingCallInterface: function() {
            const callContainer = document.getElementById('fc_callContainer');
            const callStatus = document.getElementById('fc_callStatus');
            
            callContainer.style.display = 'block';
            callStatus.textContent = `Входящий звонок от ${this.incomingCallFrom}`;
            document.getElementById('fc_callControls').style.display = 'none';
            document.getElementById('fc_incomingCall').style.display = 'block';
        },

        hideCallInterface: function() {
            const callContainer = document.getElementById('fc_callContainer');
            callContainer.style.display = 'none';
            this.cleanupCall();
        },

        cleanupCall: function() {
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
            
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }
            
            this.isCallActive = false;
            this.currentCallTarget = null;
            this.isInitiator = false;
            this.incomingOffer = null;
            this.incomingCallFrom = null;
            
            const localVideo = document.getElementById('fc_localVideo');
            const remoteVideo = document.getElementById('fc_remoteVideo');
            
            if (localVideo) localVideo.srcObject = null;
            if (remoteVideo) remoteVideo.srcObject = null;
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        familyChat.webrtc.init();
    });
})();