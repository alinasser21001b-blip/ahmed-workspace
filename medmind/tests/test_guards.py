from app.core.guards import looks_like_medical_question


def test_blocks_medical_question():
    assert looks_like_medical_question("What is the treatment for hypertension?")
    assert looks_like_medical_question("ما هو علاج السكري؟")


def test_allows_commands_and_short_text():
    assert not looks_like_medical_question("/newpack")
    assert not looks_like_medical_question("hello")
