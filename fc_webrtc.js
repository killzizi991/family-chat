window.familyChatWebRTC = {
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    isCaller: false,
    callTarget: null,
    currentCall: null,

    init: function() {
        this.setupEventListeners();
        this.createPeerConnection();
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
                    target: this.callTarget,
                    candidate: event.candidate
                }));
            }
        };

        this.peerConnection.ontrack = (event) => {
            const remoteAudio = document.getElementById('fc_remoteAudio');
            if (remoteAudio) {
                remoteAudio.srcObject = event.streams[0];
                this.remoteStream = event.streams[0];
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'connected') {
                this.showCallInterface();
            }
        };
    },

    async startCall() {
        if (!familyChat.currentChat.type === 'private' || !familyChat.currentChat.recipient) {
            alert('Выберите пользователя для звонка');
            return;
        }

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: true,
                video: false
            });
            
            this.isCaller = true;
            this.callTarget = familyChat.currentChat.recipient;
            this.currentCall = {
                caller: familyChat.currentUser,
                target: this.callTarget,
                type: 'audio'
            };

            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_offer',
                target: this.callTarget,
                offer: offer
            }));

            this.showCallInterface();

        } catch (error) {
            console.error('Error starting call:', error);
            alert('Ошибка при запуске звонка');
        }
    },

    async handleOffer(offer, fromUser) {
        this.isCaller = false;
        this.callTarget = fromUser;
        this.currentCall = {
            caller: fromUser,
            target: familyChat.currentUser,
            type: 'audio'
        };

        this.showIncomingCallUI();

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: true,
                video: false
            });

            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            await this.peerConnection.setRemoteDescription(offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_answer',
                target: fromUser,
                answer: answer
            }));

        } catch (error) {
            console.error('Error handling offer:', error);
            this.endCall();
        }
    },

    async handleAnswer(answer) {
        await this.peerConnection.setRemoteDescription(answer);
    },

    async handleIceCandidate(candidate) {
        try {
            await this.peerConnection.addIceCandidate(candidate);
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    },

    showIncomingCallUI() {
        const callUI = `
            <div id="fc_incomingCallModal" style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 0 20px rgba(0,0,0,0.2);
                z-index: 10000;
            ">
                <h3>Входящий звонок от ${this.callTarget}</h3>
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button id="fc_acceptCall" style="
                        padding: 10px 20px;
                        background: #4CAF50;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                    ">Принять</button>
                    <button id="fc_declineCall" style="
                        padding: 10px 20px;
                        background: #f44336;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                    ">Отклонить</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', callUI);
    },

    showCallInterface() {
        const callInterface = `
            <div id="fc_callInterface" style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: white;
                padding: 15px;
                border-radius: 10px;
                box-shadow: 0 0 10px rgba(0,0,0,0.1);
                z-index: 9999;
            ">
                <div style="margin-bottom: 10px;">
                    <strong>Звонок ${this.isCaller ? 'с' : 'с'} ${this.callTarget}</strong>
                </div>
                <audio id="fc_remoteAudio" autoplay></audio>
                <button id="fc_endCall" style="
                    padding: 8px 16px;
                    background: #f44336;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                ">Завершить</button>
            </div>
        `;
        
        const existingUI = document.getElementById('fc_callInterface');
        if (existingUI) existingUI.remove();
        
        document.body.insertAdjacentHTML('beforeend', callInterface);
        
        const incomingModal = document.getElementById('fc_incomingCallModal');
        if (incomingModal) incomingModal.remove();
    },

    endCall() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        this.remoteStream = null;
        this.isCaller = false;
        this.callTarget = null;
        this.currentCall = null;

        const callInterface = document.getElementById('fc_callInterface');
        if (callInterface) callInterface.remove();

        const incomingModal = document.getElementById('fc_incomingCallModal');
        if (incomingModal) incomingModal.remove();

        if (familyChat.ws) {
            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_end_call',
                target: this.callTarget
            }));
        }
    },

    acceptCall() {
        this.showCallInterface();
    },

    declineCall() {
        this.endCall();
    }
};

// Инициализация WebRTC при загрузке
document.addEventListener('DOMContentLoaded', () => {
    familyChatWebRTC.init();
});