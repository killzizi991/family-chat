window.familyChat = window.familyChat || {};

(function() {
    let localStream = null;
    let peerConnection = null;
    let currentCall = null;
    let isInitiator = false;
    let iceCandidateQueue = [];
    let pendingOffer = null;

    familyChat.webrtc = {
        init: function() {
            console.log("WebRTC модуль инициализирован");
        },

        startCall: function(targetUser) {
            if (!familyChat.ws || familyChat.ws.readyState !== WebSocket.OPEN) {
                alert('Нет соединения с сервером');
                return;
            }

            if (currentCall) {
                alert('Уже есть активный звонок');
                return;
            }

            isInitiator = true;
            currentCall = targetUser;
            familyChat.ui.showCallInterface(targetUser, true);

            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => {
                    localStream = stream;
                    familyChat.webrtc.createPeerConnection();
                    localStream.getTracks().forEach(track => {
                        peerConnection.addTrack(track, localStream);
                    });

                    peerConnection.createOffer()
                        .then(offer => peerConnection.setLocalDescription(offer))
                        .then(() => {
                            familyChat.ws.send(JSON.stringify({
                                type: 'webrtc_offer',
                                target: targetUser,
                                offer: peerConnection.localDescription
                            }));
                        })
                        .catch(error => {
                            console.error('Ошибка создания оффера:', error);
                            familyChat.webrtc.endCall();
                        });
                })
                .catch(error => {
                    console.error('Ошибка доступа к микрофону:', error);
                    alert('Не удалось получить доступ к микрофону');
                });
        },

        createPeerConnection: function() {
            const configuration = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            };

            peerConnection = new RTCPeerConnection(configuration);
            iceCandidateQueue = [];

            peerConnection.onicecandidate = event => {
                if (event.candidate) {
                    if (peerConnection.remoteDescription) {
                        familyChat.ws.send(JSON.stringify({
                            type: 'webrtc_ice_candidate',
                            target: currentCall,
                            candidate: event.candidate
                        }));
                    } else {
                        iceCandidateQueue.push(event.candidate);
                    }
                }
            };

            peerConnection.ontrack = event => {
                const remoteAudio = document.getElementById('fc_remoteAudio');
                if (remoteAudio) {
                    remoteAudio.srcObject = event.streams[0];
                    remoteAudio.play().catch(e => console.error('Ошибка воспроизведения:', e));
                }
            };

            peerConnection.onconnectionstatechange = () => {
                console.log('Состояние соединения:', peerConnection.connectionState);
                if (peerConnection.connectionState === 'connected') {
                    familyChat.ui.updateCallStatus('connected');
                }
            };
        },

        flushIceCandidates: function() {
            iceCandidateQueue.forEach(candidate => {
                familyChat.ws.send(JSON.stringify({
                    type: 'webrtc_ice_candidate',
                    target: currentCall,
                    candidate: candidate
                }));
            });
            iceCandidateQueue = [];
        },

        handleWebRTC: function(data) {
            switch (data.type) {
                case 'webrtc_offer':
                    this.handleOffer(data);
                    break;
                case 'webrtc_answer':
                    this.handleAnswer(data);
                    break;
                case 'webrtc_ice_candidate':
                    this.handleIceCandidate(data);
                    break;
                case 'webrtc_hangup':
                    this.handleHangup();
                    break;
                case 'webrtc_busy':
                    this.handleBusy();
                    break;
                case 'webrtc_reject':
                    this.handleReject();
                    break;
            }
        },

        handleOffer: function(data) {
            if (currentCall) {
                familyChat.ws.send(JSON.stringify({
                    type: 'webrtc_busy',
                    target: data.from
                }));
                return;
            }

            currentCall = data.from;
            this.pendingOffer = data.offer;
            familyChat.ui.showIncomingCall(data.from);

            setTimeout(() => {
                if (currentCall === data.from) {
                    familyChat.webrtc.acceptCall();
                }
            }, 30000);
        },

        acceptCall: function() {
            if (!currentCall || !this.pendingOffer) return;

            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => {
                    localStream = stream;
                    familyChat.webrtc.createPeerConnection();
                    localStream.getTracks().forEach(track => {
                        peerConnection.addTrack(track, localStream);
                    });

                    peerConnection.setRemoteDescription(this.pendingOffer)
                        .then(() => peerConnection.createAnswer())
                        .then(answer => peerConnection.setLocalDescription(answer))
                        .then(() => {
                            familyChat.ws.send(JSON.stringify({
                                type: 'webrtc_answer',
                                target: currentCall,
                                answer: peerConnection.localDescription
                            }));
                            familyChat.ui.showCallInterface(currentCall, false);
                            this.flushIceCandidates();
                        })
                        .catch(error => {
                            console.error('Ошибка принятия вызова:', error);
                            familyChat.webrtc.endCall();
                        });
                })
                .catch(error => {
                    console.error('Ошибка доступа к микрофону:', error);
                    familyChat.webrtc.rejectCall();
                });
        },

        handleAnswer: function(data) {
            if (!peerConnection || !currentCall) return;

            peerConnection.setRemoteDescription(data.answer)
                .then(() => {
                    this.flushIceCandidates();
                })
                .catch(error => {
                    console.error('Ошибка установки ответа:', error);
                    familyChat.webrtc.endCall();
                });
        },

        handleIceCandidate: function(data) {
            if (!peerConnection || !currentCall) return;

            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                .catch(error => {
                    console.error('Ошибка добавления ICE кандидата:', error);
                });
        },

        rejectCall: function() {
            if (!currentCall) return;

            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_reject',
                target: currentCall
            }));
            familyChat.webrtc.cleanupCall();
        },

        endCall: function() {
            if (!currentCall) return;

            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_hangup',
                target: currentCall
            }));
            familyChat.webrtc.cleanupCall();
        },

        handleHangup: function() {
            familyChat.webrtc.cleanupCall();
        },

        cleanupCall: function() {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }

            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }

            currentCall = null;
            isInitiator = false;
            iceCandidateQueue = [];
            pendingOffer = null;
            familyChat.ui.hideCallInterface();
        },

        handleBusy: function() {
            alert('Абонент занят');
            familyChat.webrtc.cleanupCall();
        },

        handleReject: function() {
            alert('Вызов отклонен');
            familyChat.webrtc.cleanupCall();
        }
    };

    document.addEventListener('DOMContentLoaded', familyChat.webrtc.init);
})();