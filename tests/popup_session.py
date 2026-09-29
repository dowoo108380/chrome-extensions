"""Raw popup attachment keeps Chrome's actual toolbar-popup viewport intact."""
import json
import time


class PopupSession:
    def __init__(self, cdp, control, target_id):
        self.cdp, self.control, self.responses, self.sequence = cdp, control, {}, 0
        self.session_id = cdp.send('Target.attachToTarget', {'targetId': target_id, 'flatten': False})['sessionId']
        cdp.on('Target.receivedMessageFromTarget', self.receive)

    def receive(self, event):
        if event['sessionId'] == self.session_id:
            message = json.loads(event['message'])
            if 'id' in message:
                self.responses[message['id']] = message

    def send(self, method, params=None):
        self.sequence += 1
        request_id = self.sequence
        self.cdp.send('Target.sendMessageToTarget', {'sessionId': self.session_id, 'message': json.dumps({'id': request_id, 'method': method, 'params': params or {}})})
        deadline = time.monotonic() + 5
        while request_id not in self.responses:
            assert time.monotonic() < deadline, method + ' timed out'
            self.control.wait_for_timeout(10)
        response = self.responses.pop(request_id)
        assert 'error' not in response, response
        return response.get('result', {})

    def click(self, x, y):
        self.send('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
        self.send('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})

    def key(self, key, code):
        for kind in ['keyDown', 'keyUp']:
            self.send('Input.dispatchKeyEvent', {'type': kind, 'key': key, 'code': key, 'windowsVirtualKeyCode': code, 'nativeVirtualKeyCode': code})
