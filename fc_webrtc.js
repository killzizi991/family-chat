window.familyChat.webrtc = {
    peerConnection: null,
    localStream: null,
    isCalling: false,
    isInCall: false,
    callTarget: null,
    currentOffer: null,

    init: function() {
        this.setupEventListeners();
    },

    setupEventListeners: function() {
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fc_callButton') {
                this.startCall();
            } else if (e.target.id === 'fc_acceptCall') {
                this.acceptCall();
            } else if (e.target.id === 'fc_rejectCall' || e.target.id === 'fc_endCall') {
                this.endCall();
            }
        });
    },

    startCall: function() {
        if (!familyChat.currentChat.recipient || familyChat.currentChat.type !== 'private') {
            alert('Выберите пользователя для звонка');
            return;
        }

        if (this.isInCall) {
            alert('Уже идет звонок');
            return;
        }

        this.callTarget = familyChat.currentChat.recipient;
        this.isCalling = true;
        this.showCallInterface('calling');

        this.initiateCall();
    },

    initiateCall: async function() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                video: false, 
                audio: true 
            });

            this.createPeerConnection();
            
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_offer',
                targetUser: this.callTarget,
                data: offer
            }));

        } catch (error) {
            console.error('Ошибка инициализации звонка:', error);
            this.endCall();
        }
    },

    acceptCall: async function() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                video: false, 
                audio: true 
            });

            this.createPeerConnection();
            
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            await this.peerConnection.setRemoteDescription(this.currentOffer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_answer',
                targetUser: this.callTarget,
                data: answer
            }));

            this.isInCall = true;
            this.showCallInterface('active');

        } catch (error) {
            console.error('Ошибка принятия звонка:', error);
            this.endCall();
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
                    type: 'webrtc_ice_candidate',
                    targetUser: this.callTarget,
                    data: event.candidate
                }));
            }
        };

        this.peerConnection.ontrack = (event) => {
            const audio = document.getElementById('fc_remoteAudio');
            if (audio) {
                audio.srcObject = event.streams[0];
                audio.play().catch(e => console.error('Ошибка воспроизведения:', e));
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            if (this.peerConnection.connectionState === 'connected') {
                console.log('PeerConnection установлен');
            } else if (this.peerConnection.connectionState === 'disconnected' ||
                       this.peerConnection.connectionState === 'failed') {
                this.endCall();
            }
        };
    },

    handleOffer: async function(offer, fromUser) {
        if (this.isInCall || this.isCalling) {
            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_hangup',
                targetUser: fromUser,
                data: { reason: 'busy' }
            }));
            return;
        }

        this.callTarget = fromUser;
        this.currentOffer = offer;
        this.showIncomingCallInterface();
    },

    handleAnswer: async function(answer) {
        if (!this.peerConnection) return;
        
        try {
            await this.peerConnection.setRemoteDescription(answer);
            this.isInCall = true;
            this.showCallInterface('active');
        } catch (error) {
            console.error('Ошибка обработки ответа:', error);
            this.endCall();
        }
    },

    handleIceCandidate: async function(candidate) {
        if (!this.peerConnection) return;
        
        try {
            await this.peerConnection.addIceCandidate(candidate);
        } catch (error) {
            console.error('Ошибка добавления ICE кандидата:', error);
        }
    },

    handleHangup: function() {
        this.endCall();
        alert('Собеседник завершил звонок');
    },

    handleWebRTCMessage: function(message) {
        try {
            switch (message.type) {
                case 'webrtc_offer':
                    this.handleOffer(message.data, message.fromUser);
                    break;
                case 'webrtc_answer':
                    this.handleAnswer(message.data);
                    break;
                case 'webrtc_ice_candidate':
                    this.handleIceCandidate(message.data);
                    break;
                case 'webrtc_hangup':
                    this.handleHangup();
                    break;
            }
        } catch (e) {
            console.error('Ошибка обработки WebRTC сообщения:', e);
        }
    },

    endCall: function() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        this.isCalling = false;
        this.isInCall = false;

        if (this.callTarget) {
            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_hangup',
                targetUser: this.callTarget,
                data: { reason: 'ended' }
            }));
        }

        this.hideCallInterface();
        this.callTarget = null;
        this.currentOffer = null;
    },

    showCallInterface: function(state) {
        let callInterface = document.getElementById('fc_callInterface');
        if (!callInterface) {
            callInterface = document.createElement('div');
            callInterface.id = 'fc_callInterface';
            callInterface.innerHTML = `
                <div id="fc_callContainer">
                    <div id="fc_callStatus"></div>
                    <audio id="fc_remoteAudio" autoplay></audio>
                    <div id="fc_callButtons">
                        <button id="fc_endCall">Завершить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(callInterface);
        }

        const status = document.getElementById('fc_callStatus');
        const buttons = document.getElementById('fc_callButtons');

        if (state === 'calling') {
            status.textContent = `Звонок ${this.callTarget}...`;
            buttons.innerHTML = '<button id="fc_endCall">Отмена</button>';
        } else if (state === 'active') {
            status.textContent = `Разговор с ${this.callTarget}`;
            buttons.innerHTML = '<button id="fc_endCall">Завершить</button>';
        }

        callInterface.style.display = 'block';
    },

    showIncomingCallInterface: function() {
        const callInterface = document.createElement('div');
        callInterface.id = 'fc_incomingCall';
        callInterface.innerHTML = `
            <div id="fc_incomingCallContainer">
                <div>Входящий звонок от ${this.callTarget}</div>
                <div id="fc_incomingCallButtons">
                    <button id="fc_acceptCall">Принять</button>
                    <button id="fc_rejectCall">Отклонить</button>
                </div>
            </div>
        `;
        document.body.appendChild(callInterface);

        setTimeout(() => {
            if (document.getElementById('fc_incomingCall')) {
                this.endCall();
            }
        }, 30000);
    },

    hideCallInterface: function() {
        const callInterface = document.getElementById('fc_callInterface');
        const incomingCall = document.getElementById('fc_incomingCall');
        
        if (callInterface) callInterface.style.display = 'none';
        if (incomingCall) incomingCall.remove();
    }
};

// Инициализация WebRTC при загрузке
document.addEventListener('DOMContentLoaded', () => {
    familyChat.webrtc.init();
});