#! /usr/bin/env perl

use strict;
use warnings;

use JSON;

# give it the location of the source directory of the mtgen project
# as the first argument, and the location of mtgjson's AllSets-x.json
# as the second
my ($mtgen_dir, $mtgjson_file, @wanted_sets) = @ARGV;
$mtgen_dir .= '/src/mtgen';

undef $/;

my $mtgjson = load_json_file($mtgjson_file);
my $mtgjson_idx = index_mtgjson($mtgjson);

my %retval;

my $sets_json = load_sets_json("$mtgen_dir/wwwroot");

my $set_meta_dir = "$mtgen_dir/Views/Set";

opendir(my $dh, $set_meta_dir) or die "can't opendir $set_meta_dir: $!";
foreach my $file (readdir $dh) {
	if($file =~ /\.json$/ && -f "$set_meta_dir/$file") {
		my $set = $file;
		$set =~ s/\.json$//;
		next unless(set_wanted($set));
		my $data = process_set("$set_meta_dir/$file", "$mtgen_dir", $set, $sets_json, $mtgjson_idx);
		$retval{$set} = $data if($data);
	}
}
close($dh);

print to_json(\%retval, { pretty => 0 });

sub set_wanted {
	my ($set) = @_;

	return 1 if(@wanted_sets == 0);

	foreach my $want (@wanted_sets) {
		return 1 if($set eq $want);
	}

	return 0;
}

sub load_json_file {
	my ($fname) = @_;
	
	open(my $fh, $fname) or
		die "can't open $fname: $!";
	
	my $contents = <$fh>;
	# some files contain the UTF8 BOM, don't want it
	$contents =~ s/^\xef\xbb\xbf//; 
	my $data = from_json($contents);

	close($fh);

	return $data;
}

sub process_set {
	my ($meta_file, $mtgen_dir, $setcode, $sets_json, $mtgjson_idx) = @_;
	my $dir = "$mtgen_dir/wwwroot/$setcode";

	my $meta_json = load_json_file($meta_file);

	my ($packs, $defs) = get_packs_and_defs($dir, $meta_json);

	if(scalar(keys %$packs) == 0) {
		return undef;
	}

	return { 
		cards => get_cards($dir, get_cardfiles($meta_json), $mtgjson_idx),
		packs => $packs,
		defs => $defs,
		date => get_packdate($setcode, $sets_json),
	};
}

sub get_cardfiles {
	my ($meta_json) = @_;

	my @rv = @{ $meta_json->{CardFiles} };

	return [ sort @rv ];
}

sub warn_rename {
	my ($card) = @_;
	print STDERR "renaming $card->{set} / $card->{title}\n";
}

sub find_mtgjson {
	my ($card, $mtgjson_idx) = @_;

	my $fixed_name = lc($card->{title});
	warn_rename($card) if($fixed_name =~ s/\xE2\x80\x99/'/g);
	warn_rename($card) if($fixed_name =~ s/\x92/'/g);
	warn_rename($card) if($fixed_name =~ s/(\x93|\x94)/"/g);
	warn_rename($card) if($fixed_name =~ s/\xE3\x86/ae/g);
	warn_rename($card) if($fixed_name =~ s/\xE6/ae/g);

	my $lcset = lc($card->{set});
	if(exists($mtgjson_idx->{$lcset})) {
		my $rv;
		if(exists($card->{num}) && ($card->{num} =~ /^(\d+)/)) {
			$rv = $mtgjson_idx->{"SN:$lcset:".int($1)};
			if(!$rv || lc($rv->{name}) ne $fixed_name) {
				$rv = undef;
			}
		}
		if(!$rv) {
			$rv = $mtgjson_idx->{$lcset}->{$fixed_name};
		}
		if(!$rv && exists($card->{multiverseid})) {
			$rv = $mtgjson_idx->{'MVI:'.$card->{multiverseid}};
		}
		my %masterpiece_map = (
			kld => 'mps',
			aer => 'mps',

			# not actually masterpieces
			frf => 'frf_ugin', 
		);
		#if(!$rv && $card->{masterpiece}) {
		if(!$rv && exists($masterpiece_map{$lcset})) {
			$rv = $mtgjson_idx->{$masterpiece_map{$lcset}}->{$fixed_name};
		}
		if(!$rv && $fixed_name =~ / & /) {
			# may be a split card
			my $left_name = $fixed_name;
			$left_name =~ s/ &.*$//;
			$rv = $mtgjson_idx->{$lcset}->{$left_name};
			if(!$rv) {
				$rv = $mtgjson_idx->{$masterpiece_map{$lcset}}->{$left_name};
			}
		}
		if(!$rv && $fixed_name =~ /\(.*\)/) {
			# FIXME: double-faced cards are twice in the database meaning
			# they have a higher chance of being generated!
			# double-faced cards
			$fixed_name =~ s/ ?\(.*\) ?//;
			$rv = $mtgjson_idx->{$lcset}->{$fixed_name};
		}
		if(!$rv && (!exists($card->{usableForDeckBuilding})
				|| $card->{usableForDeckBuilding})) {
			print STDERR "card not found: ". to_json([$card, $fixed_name, $lcset], { pretty => 1 });
			return undef;
		}
		return $rv;
	} else {
		print STDERR "couldn't find this set in mtgjson: $lcset\n" . to_json($card);
	}

	return undef;
}

sub get_cards {
	my ($dir, $cardfiles, $mtgjson_idx) = @_;

	my @cards;
	foreach my $cardf (@$cardfiles) {
		push @cards, @{ load_json_file("$dir/$cardf") };
	}

	foreach my $card (@cards) {
		$card->{mtgjson} = find_mtgjson($card, $mtgjson_idx);
	}

	return \@cards;
}

sub get_packs_and_defs {
	my ($dir, $meta_json) = @_;
	
	my (%packs, @defs);

	foreach my $packfile (map { load_json_file("$dir/$_") } @{ $meta_json->{PackFiles} }) {
		foreach my $pack (@{ $packfile->{packs}}) {
			$packs{$pack->{packName}} = $pack;
		}
		foreach my $def (@{ $packfile->{defs} }) {
			die "oops" if(exists($def->{querySet}));
			die "oops2" unless(exists($def->{query}));
			push @defs, $def;
		}
	}

	return (\%packs, \@defs);
}

sub load_sets_json {
	my ($dir) = @_;

	return load_json_file("$dir/sets.json");
}

sub parse_date {
	my ($date) = @_;

	my %map = qw/Jan 1 Feb 2 Mar 3 Apr 4 May 5 Jun 6 Jul 7 Aug 8 Sep 9 Oct 10 Nov 11 Dec 12/;
	$date =~ /^(\d+)-([A-Za-z]+)-(\d+)$/
		or die "invalid date $date";

	return sprintf("%04d%02d%02d", $3, $map{$2}, $1);
}

sub get_packdate {
	my ($dir, $sets) = @_;

	foreach my $set (@$sets) {
		if(lc($set->{code}) eq lc($dir)) {
			return parse_date($set->{releaseDate});
		}
	}

	return undef;
}

sub index_mtgjson {
	my ($mj) = @_;

	my %idx;

	foreach my $set (keys %{ $mj }) {
		foreach my $card (@{ $mj->{$set}->{cards} }) {
			# to keep the file a bit smaller
			delete $card->{legalities};
			delete $card->{foreignNames};
			delete $card->{id};
			delete $card->{originalText};
			delete $card->{flavor};
			delete $card->{printings};

			$idx{lc($set)}->{lc($card->{name})} = $card;
			if(exists($card->{multiverseid})) {
				$idx{'MVI:'.$card->{multiverseid}} = $card;
			}
			if(exists($card->{number})) {
				my $num = $card->{number};
				if($num =~ /^(\d+)a?$/) {
					$idx{'SN:'.lc($set).':'.int($1)} = $card;
				}
			}
		}
	}

	return \%idx;
}
