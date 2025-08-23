window.familyChat = window.familyChat || {};

(function() {
    familyChat.webrtc = {
        peerConnection: null,
        localStream: null,
        remoteStream: null,
        isCallActive: false,
        currentCallTarget: null,
        callTimeout: null,

        init: function() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
                console.error("WebRTC не поддерживается в этом браузере");
                const callButton = document.getElementById('fc_callButton');
                if (callButton) {
                    callButton.style.display = 'none';
                }
                return;
            }
            this.setupEventListeners();
            console.log("WebRTC модуль инициализирован");
        },

        setupEventListeners: function() {
            document.addEventListener('click', (e) => {
                if (e.target.id === 'fc_callButton') {
                    this.startCall();
                } else if (e.target.id === 'fc_acceptCall') {
                    this.acceptCall();
                } else if (e.target.id === 'fc_rejectCall') {
                    this.rejectCall();
                } else if (e.target.id === 'fc_endCall') {
                    this.endCall();
                }
            });
        },

        startCall: function() {
            if (!familyChat.currentChat.recipient) {
                alert('Выберите пользователя для звонка');
                return;
            }

            if (this.isCallActive) {
                alert('Звонок уже активен');
                return;
            }

            this.currentCallTarget = familyChat.currentChat.recipient;
            this.showCallInterface('outgoing');
            
            familyChat.ws.send(JSON.stringify({
                type: 'call_request',
                target: this.currentCallTarget
            }));

            this.callTimeout = setTimeout(() => {
                if (!this.isCallActive) {
                    this.endCall();
                    alert('Пользователь не ответил');
                }
            }, 30000);
        },

        acceptCall: function() {
            this.hideIncomingCall();
            this.showCallInterface('active');
            this.setupPeerConnection(true);
        },

        rejectCall: function() {
            familyChat.ws.send(JSON.stringify({
                type: 'call_answer',
                response: 'reject',
                from: familyChat.incomingCallFrom
            }));
            this.hideIncomingCall();
            this.cleanupCall();
        },

        endCall: function() {
            if (this.currentCallTarget) {
                familyChat.ws.send(JSON.stringify({
                    type: 'call_end',
                    target: this.currentCallTarget
                }));
            }
            this.cleanupCall();
        },

        handleIncomingCall: function(from) {
            if (this.isCallActive) {
                familyChat.ws.send(JSON.stringify({
                    type: 'call_answer',
                    response: 'busy',
                    from: from
                }));
                return;
            }

            familyChat.incomingCallFrom = from;
            this.showIncomingCall(from);
        },

        showIncomingCall: function(from) {
            const callDiv = document.createElement('div');
            callDiv.id = 'fc_incomingCall';
            callDiv.innerHTML = `
                <div class="call-alert">
                    <h3>Входящий звонок от ${from}</h3>
                    <button id="fc_acceptCall">Принять</button>
                    <button id="fc_rejectCall">Отклонить</button>
                </div>
            `;
            document.body.appendChild(callDiv);
        },

        hideIncomingCall: function() {
            const incomingCall = document.getElementById('fc_incomingCall');
            if (incomingCall) {
                incomingCall.remove();
            }
        },

        showCallInterface: function(type) {
            let callInterface = document.getElementById('fc_callInterface');
            if (!callInterface) {
                callInterface = document.createElement('div');
                callInterface.id = 'fc_callInterface';
                document.body.appendChild(callInterface);
            }

            if (type === 'outgoing') {
                callInterface.innerHTML = `
                    <div class="call-container">
                        <h3>Звонок ${this.currentCallTarget}</h3>
                        <p>Ожидание ответа...</p>
                        <button id="fc_endCall">Завершить</button>
                    </div>
                `;
            } else if (type === 'active') {
                callInterface.innerHTML = `
                    <div class="call-container">
                        <h3>Разговор с ${this.currentCallTarget}</h3>
                        <div class="video-container">
                            <video id="fc_localVideo" autoplay muted></video>
                            <video id="fc_remoteVideo" autoplay></video>
                        </div>
                        <button id="fc_endCall">Завершить</button>
                    </div>
                `;
            }

            callInterface.style.display = 'block';
        },

        hideCallInterface: function() {
            const callInterface = document.getElementById('fc_callInterface');
            if (callInterface) {
                callInterface.style.display = 'none';
            }
        },

        setupPeerConnection: function(isAnswerer = false) {
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
                        target: this.currentCallTarget,
                        data: event.candidate
                    }));
                }
            };

            this.peerConnection.ontrack = (event) => {
                const remoteVideo = document.getElementById('fc_remoteVideo');
                if (remoteVideo && event.streams[0]) {
                    remoteVideo.srcObject = event.streams[0];
                    this.remoteStream = event.streams[0];
                }
            };

            if (isAnswerer) {
                this.addLocalStream();
                this.createAnswer();
            } else {
                this.addLocalStream();
                this.createOffer();
            }
        },

        async addLocalStream() {
            try {
                if (!this.peerConnection) {
                    console.error('PeerConnection не инициализирован');
                    return;
                }

                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });

                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });

                const localVideo = document.getElementById('fc_localVideo');
                if (localVideo) {
                    localVideo.srcObject = this.localStream;
                }
            } catch (error) {
                console.error('Ошибка доступа к медиаустройствам:', error);
                let errorMessage;
                if (error.name === 'NotAllowedError') {
                    errorMessage = 'Доступ к камере/микрофону запрещен. Разрешите доступ в настройках браузера и попробуйте снова.';
                } else if (error.name === 'NotFoundError') {
                    errorMessage = 'Не найдено подходящее устройство. Убедитесь, что камера и микрофон подключены.';
                } else if (error.name === 'OverConstrainedError') {
                    errorMessage = 'Невозможно удовлетворить ограничениям доступа. Попробуйте выбрать другие устройства.';
                } else {
                    errorMessage = `Неизвестная ошибка: ${error.message}`;
                }
                alert(errorMessage);
                this.endCall();
            }
        },

        async createOffer() {
            try {
                if (!this.peerConnection) {
                    console.error('PeerConnection не инициализирован');
                    return;
                }

                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);

                familyChat.ws.send(JSON.stringify({
                    type: 'webrtc_offer',
                    target: this.currentCallTarget,
                    data: offer
                }));
            } catch (error) {
                console.error('Ошибка создания offer:', error);
                this.endCall();
            }
        },

        async createAnswer() {
            try {
                if (!this.peerConnection) {
                    console.error('PeerConnection не инициализирован');
                    return;
                }

                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);

                familyChat.ws.send(JSON.stringify({
                    type: 'webrtc_answer',
                    target: this.currentCallTarget,
                    data: answer
                }));
            } catch (error) {
                console.error('Ошибка создания answer:', error);
                this.endCall();
            }
        },

        async handleOffer(offer) {
            if (!this.peerConnection) {
                this.setupPeerConnection(true);
            }

            try {
                await this.peerConnection.setRemoteDescription(offer);
                this.addLocalStream();
            } catch (error) {
                console.error('Ошибка обработки offer:', error);
                this.endCall();
            }
        },

        async handleAnswer(answer) {
            try {
                if (!this.peerConnection) {
                    console.error('PeerConnection не инициализирован');
                    return;
                }

                await this.peerConnection.setRemoteDescription(answer);
            } catch (error) {
                console.error('Ошибка обработки answer:', error);
                this.endCall();
            }
        },

        async handleIceCandidate(candidate) {
            try {
                if (!this.peerConnection) {
                    console.error('PeerConnection не инициализирован');
                    return;
                }

                await this.peerConnection.addIceCandidate(candidate);
            } catch (error) {
                console.error('Ошибка добавления ICE candidate:', error);
            }
        },

        cleanupCall: function() {
            if (this.callTimeout) {
                clearTimeout(this.callTimeout);
                this.callTimeout = null;
            }

            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }

            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }

            this.hideCallInterface();
            this.hideIncomingCall();
            this.isCallActive = false;
            this.currentCallTarget = null;
            familyChat.incomingCallFrom = null;
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        familyChat.webrtc.init();
    });
})();