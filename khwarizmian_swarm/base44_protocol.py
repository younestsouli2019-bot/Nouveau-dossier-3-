from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import InvalidSignature
import json
import base64
import time


class Base44Packet:
    def __init__(self, private_key=None):
        self.private_key = private_key or self._generate_key_pair()
        self.public_key = self.private_key.public_key()

    def _generate_key_pair(self):
        return rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def serialize_public_key(self):
        return self.public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        )

    def create_packet(self, intent, parameters, impact_score=0):
        packet = {
            'origin': self.serialize_public_key().decode('utf-8'),
            'intent': intent,
            'parameters': parameters,
            'impact': impact_score,
            'timestamp': time.time(),
            'recall': True
        }
        packet_json = json.dumps(packet, sort_keys=True).encode('utf-8')
        signature = self.private_key.sign(
            packet_json,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        return base64.b64encode(packet_json + b'|||' + signature).decode('utf-8')

    def verify_and_decode_packet(self, encoded_packet):
        try:
            decoded = base64.b64decode(encoded_packet)
            packet_json, signature = decoded.split(b'|||')
            packet_data = json.loads(packet_json.decode('utf-8'))
            sender_public_key = serialization.load_pem_public_key(
                packet_data['origin'].encode('utf-8')
            )
            sender_public_key.verify(
                signature,
                packet_json,
                padding.PSS(
                    mgf=padding.MGF1(hashes.SHA256()),
                    salt_length=padding.PSS.MAX_LENGTH
                ),
                hashes.SHA256()
            )
            return packet_data
        except (ValueError, InvalidSignature, json.JSONDecodeError):
            return None
