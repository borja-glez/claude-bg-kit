# Publishing to Hugging Face

## The card

The model card is the `README.md` of the Hub repository, written in English. Its source lives in the project repo and is uploaded as it is.

It carries:
- what it is and its base model;
- the data, its license, and the unit the split was made by;
- the recipe: configuration, steps, seed, the class of hardware (never a card model);
- the table `| Milestone | Bar (written before training) | Measured | Verdict |`, never rewritten after measuring;
- how to reproduce it: run id, commit, command;
- limits;
- the license of the weights.

If a milestone had no criterion, the card says so, and the next milestone's criterion is written before its training.

## The token

Read it from `HF_TOKEN` or from the login (`hf auth login`). It never appears in a file, a cell or an output. Before publishing, look for leftovers with `git grep -n "hf_"` and clear the outputs of notebooks that printed it. If a token was ever printed, revoke it and issue another.

## Upload

Create the repo, then upload the folder with `HfApi.upload_folder` (or `hf upload` in the terminal); the token is picked up from the environment, so `HfApi()` takes no `token=`. A single file, such as the card, goes with `upload_file` and `path_in_repo="README.md"`. Pass `repo_type="dataset"` for a dataset. An interrupted upload resumes by repeating the same call. Check the signatures against the installed `huggingface_hub`.
